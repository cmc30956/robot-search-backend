// server.js
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const Fuse = require('fuse.js'); // For fuzzy searching
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const PORT = process.env.PORT || 3001;

// Use CORS middleware to allow cross-origin requests
app.use(cors());
app.use(express.json());

// Initialize Google Generative AI
// This API key should be stored securely, not hardcoded in a real application.
const genAI = new GoogleGenerativeAI(''); // Your API key will be provided automatically in the canvas environment.

// GitHub API base URL
const GITHUB_API_URL = 'https://api.github.com/search/repositories';

// Hugging Face API base URL
const HUGGING_FACE_API_URL = 'https://huggingface.co/api/models';

/**
 * Standardizes GitHub project data into a consistent format.
 * @param {object} item - A single project returned by the GitHub API.
 * @returns {object} - The standardized project object.
 */
const standardizeGithubProject = (item) => ({
  id: item.id,
  name: item.full_name,
  description: item.description,
  url: item.html_url,
  source: 'GitHub',
  tags: item.topics || [], // Use topics as tags
  stars: item.stargazers_count,
});

/**
 * Standardizes Hugging Face model data into a consistent format.
 * @param {object} item - A single model returned by the Hugging Face API.
 * @returns {object} - The standardized model object.
 */
const standardizeHuggingFaceModel = (item) => ({
  id: item.id,
  name: item.modelId,
  description: item.pipeline_tag, // Use pipeline_tag as a description
  url: `https://huggingface.co/${item.modelId}`,
  source: 'Hugging Face',
  tags: item.tags || [],
  downloads: item.downloads,
});

/**
 * Gets a date string for a given number of days ago.
 * @param {number} days - The number of days to subtract from the current date.
 * @returns {string} - The formatted date string (YYYY-MM-DD).
 */
const getDateNDaysAgo = (days) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().split('T')[0];
};

/**
 * Main search API endpoint.
 */
app.get('/api/search', async (req, res) => {
  const { query, source, tags, sort } = req.query;

  let allResults = [];
  const searchPromises = [];

  const date7DaysAgo = getDateNDaysAgo(7);
  const date30DaysAgo = getDateNDaysAgo(30);

  // If the request is for GitHub or all sources
  if (source === 'All' || source === 'GitHub') {
    let githubQuery = query || 'robotics'; // Use 'robotics' as a fallback query
    let githubSort = 'stars';

    if (sort === 'growth_week') {
      githubQuery += ` pushed:>${date7DaysAgo}`;
    } else if (sort === 'growth_month') {
      githubQuery += ` pushed:>${date30DaysAgo}`;
    }

    searchPromises.push(
      axios.get(GITHUB_API_URL, {
        params: {
          q: githubQuery,
          sort: githubSort,
          per_page: 50,
        },
      })
      .then(response => {
        const githubProjects = response.data.items.map(standardizeGithubProject);
        allResults = allResults.concat(githubProjects);
      })
      .catch(error => {
        console.error('Error fetching from GitHub API:', error.message);
      })
    );
  }

  // If the request is for Hugging Face or all sources
  if (source === 'All' || source === 'Hugging Face') {
    const huggingFaceParams = {
      limit: 50,
      search: query || 'robot', // Use 'robot' as a fallback search term
    };

    if (sort === 'growth_week' || sort === 'growth_month') {
      huggingFaceParams.sort = 'lastUpdated';
    } else {
      huggingFaceParams.sort = 'downloads';
    }

    searchPromises.push(
      axios.get(HUGGING_FACE_API_URL, { params: huggingFaceParams })
      .then(response => {
        const huggingFaceModels = response.data.map(standardizeHuggingFaceModel);
        allResults = allResults.concat(huggingFaceModels);
      })
      .catch(error => {
        console.error('Error fetching from Hugging Face API:', error.message);
      })
    );
  }

  // Wait for all API requests to complete
  await Promise.allSettled(searchPromises);

  // Apply a local fuzzy search to the API results to better match the user's query
  const fuseOptions = {
    includeScore: true,
    keys: ['name', 'description', 'tags'],
    threshold: 0.4,
  };
  const fuse = new Fuse(allResults, fuseOptions);
  let finalResults = allResults;

  if (query) {
    const fuseResults = fuse.search(query);
    finalResults = fuseResults.map(result => result.item);
  }

  // If tags are provided, filter the results
  if (tags && tags.length > 0) {
    const selectedTagsArray = tags.split(',');
    finalResults = finalResults.filter(project =>
      project.tags && project.tags.some(tag => selectedTagsArray.includes(tag))
    );
  }

  // Final sort logic for all combined results
  finalResults.sort((a, b) => {
    const scoreA = a.stars || a.downloads || 0;
    const scoreB = b.stars || b.downloads || 0;
    return scoreB - scoreA;
  });

  res.json(finalResults);
});

// New smart search API endpoint using Gemini
app.post('/api/smart-search', async (req, res) => {
  const { description } = req.body;

  if (!description) {
    return res.status(400).json({ error: '描述不能为空' });
  }

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = `
      根据以下项目描述，生成适合在 GitHub 和 Hugging Face 上搜索的关键词。
      请以英文逗号分隔的字符串形式返回，例如: "robotics, human-robot interaction, reinforcement learning"。
      如果描述中包含了具体的项目名称，请也包含在内。

      描述: ${description}
    `;

    let keywords;
    try {
      const result = await model.generateContent(prompt);
      const response = await result.response;
      keywords = response.text().trim();
    } catch (apiError) {
      console.error('Gemini API 调用失败:', apiError.message);
      // Fallback to a simple keyword extraction if Gemini fails
      keywords = description.split(' ').join(',');
      console.log('使用回退关键词:', keywords);
    }
    
    console.log('生成的关键词:', keywords);

    // Now, call the main search API with the generated keywords
    const responseFromSearch = await axios.get(`${req.protocol}://${req.get('host')}/api/search`, {
      params: {
        query: keywords,
        source: 'All', // We search all sources
        tags: '',
        sort: 'stars',
      },
      timeout: 15000 // 15 seconds timeout
    });

    res.json({ keywords, results: responseFromSearch.data });

  } catch (error) {
    console.error('智能搜索失败:', error.message);
    res.status(500).json({ error: '智能搜索失败，请重试。' });
  }
});


// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

