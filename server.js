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
// This API key is now retrieved from an environment variable for security and deployment.
const API_KEY = process.env.GEMINI_API_KEY; 
const genAI = new GoogleGenerativeAI(API_KEY);

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

    // Split the query into multiple keywords and create a promise for each search
    const keywords = githubQuery.split(',');
    for (const keyword of keywords) {
      searchPromises.push(
        axios.get(GITHUB_API_URL, {
          params: {
            q: keyword.trim(),
            sort: githubSort,
            per_page: 50,
          },
        })
        .then(response => {
          const githubProjects = response.data.items.map(standardizeGithubProject);
          allResults = allResults.concat(githubProjects);
        })
        .catch(error => {
          console.error(`Error fetching from GitHub API for keyword "${keyword.trim()}":`, error.message);
        })
      );
    }
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

    // Split the query into multiple keywords and create a promise for each search
    const keywords = huggingFaceParams.search.split(',');
    for (const keyword of keywords) {
      const singleSearchParams = {
        ...huggingFaceParams,
        search: keyword.trim(),
      };
      searchPromises.push(
        axios.get(HUGGING_FACE_API_URL, { params: singleSearchParams })
        .then(response => {
          const huggingFaceModels = response.data.map(standardizeHuggingFaceModel);
          allResults = allResults.concat(huggingFaceModels);
        })
        .catch(error => {
          console.error(`Error fetching from Hugging Face API for keyword "${keyword.trim()}":`, error.message);
        })
      );
    }
  }

  // Wait for all API requests to complete
  await Promise.allSettled(searchPromises);

  // Remove duplicates from the results
  const uniqueResults = allResults.reduce((acc, current) => {
    const x = acc.find(item => item.id === current.id && item.source === current.source);
    if (!x) {
      return acc.concat([current]);
    } else {
      return acc;
    }
  }, []);

  // Apply a local fuzzy search to the API results to better match the user's query
  const fuseOptions = {
    includeScore: true,
    keys: ['name', 'description', 'tags'],
    threshold: 0.4,
  };
  const fuse = new Fuse(uniqueResults, fuseOptions);
  let finalResults = uniqueResults;

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

  // Check if API key is set
  if (!API_KEY) {
    console.error('GEMINI_API_KEY is not set in environment variables.');
    return res.status(500).json({ error: '服务器配置错误：缺少 API 密钥。' });
  }

  let finalResults = [];
  let suggestedKeywords = [];
  let keywords = description;

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    // A prompt to generate a list of keywords from a natural language description.
    const searchPrompt = `
      Based on the following project description, generate keywords suitable for searching on GitHub and Hugging Face.
      If the description is a single, broad term, generate several more specific synonyms.
      Generate multiple keywords of varying specificity, and return them as a single comma-separated English string.
      For example, for the description "A project for controlling a humanoid robot", return keywords like:
      "humanoid robot, robotics, humanoid, robot control, open-source robotics, artificial intelligence"
      For the description "motor", return keywords like:
      "motor, stepper motor, BLDC, servo motor, actuator"
      For the description "人形机器人", return keywords like:
      "humanoid robot, humanoid, robotics, robot"

      Description: ${description}
    `;

    try {
      const result = await model.generateContent(searchPrompt);
      const response = result.response;
      keywords = response.text().trim();
    } catch (apiError) {
      console.error('Gemini API call failed:', apiError.message);
      keywords = description; // Fallback to original description if Gemini fails
      console.log('Using fallback keywords:', keywords);
    }
    
    console.log('Generated keywords:', keywords);

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

    finalResults = responseFromSearch.data;

    // If smart search with Gemini keywords yielded no results, fall back to the original query
    if (finalResults.length === 0) {
      console.warn('Smart search with Gemini keywords returned no results. Falling back to original query.');
      
      const fallbackResponse = await axios.get(`${req.protocol}://${req.get('host')}/api/search`, {
        params: {
          query: description,
          source: 'All',
          tags: '',
          sort: 'stars',
        },
        timeout: 15000
      });
      finalResults = fallbackResponse.data;
    }

    // Now, generate related keywords based on the final results for interactive search
    if (finalResults.length > 0) {
      const searchResultString = finalResults.slice(0, 5).map(item => `${item.name}: ${item.tags.join(', ')}`).join('; ');
      const suggestionPrompt = `
        Based on the following search results, generate 3-5 more specific, related English search keywords, separated by commas. Do not include the original query terms.
        Example search results: "${searchResultString}"
      `;

      try {
        const suggestionResult = await model.generateContent(suggestionPrompt);
        const suggestionResponse = suggestionResult.response;
        suggestedKeywords = suggestionResponse.text().trim().split(',').map(kw => kw.trim());
      } catch (suggestionError) {
        console.error('Gemini API failed to generate suggestions:', suggestionError.message);
      }
    }
    
    res.json({ keywords: keywords, results: finalResults, suggestions: suggestedKeywords });

  } catch (error) {
    console.error('Smart search failed:', error.message);
    res.status(500).json({ error: 'Smart search failed, please try again.' });
  }
});


// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

