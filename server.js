// server.js
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const Fuse = require('fuse.js'); // For fuzzy searching

const app = express();
const PORT = process.env.PORT || 3001;

// Use CORS middleware to allow cross-origin requests
app.use(cors());

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
  const { query, source, tags, sort, robotType } = req.query;

  let allResults = [];
  const searchPromises = [];

  const date7DaysAgo = getDateNDaysAgo(7);
  const date30DaysAgo = getDateNDaysAgo(30);

  // A helper function to build the base search query for APIs
  const getSearchQuery = (baseQuery) => {
    let finalQuery = `${baseQuery || ''}`;
    finalQuery += ` robotics`; // Always include 'robotics'
    return finalQuery.trim();
  };
  
  // Define a map for internal filtering keywords
  const robotTypeKeywords = {
    '人型机器人': ['humanoid', 'bipedal'],
    '移动机器人': ['mobile', 'rover', 'agv', 'navigation'],
    '机械臂': ['robotic-arm', 'manipulator', 'end-effector'],
    '足式机器人': ['legged-robot', 'quadrupedal', 'hexapod'],
    '灵巧手': ['dexterous-hand', 'gripper', 'manipulation'],
    '桌面机器人': ['desktop-robot', 'tiny-robot'],
    '宠物机器人': ['pet-robot', 'companion-robot'],
    '教育机器人': ['educational-robot', 'teaching-robot', 'STEM'],
  };

  // If the request is for GitHub or all sources
  if (source === 'All' || source === 'GitHub') {
    let githubQuery = getSearchQuery(query);
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
      search: getSearchQuery(query),
      limit: 50,
      pipeline_tag: 'reinforcement-learning|computer-vision|text-to-speech|automatic-speech-recognition|visual-question-answering'
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

  // Apply internal filtering based on robot type keywords
  let finalResults = allResults;
  if (robotType && robotType !== 'All' && robotTypeKeywords[robotType]) {
    const keywords = robotTypeKeywords[robotType];
    const regex = new RegExp(keywords.join('|'), 'i'); // Case-insensitive regex
    finalResults = finalResults.filter(project => {
      // Check name, description, and tags for matching keywords
      return (
        (project.name && regex.test(project.name)) ||
        (project.description && regex.test(project.description)) ||
        (project.tags && project.tags.some(tag => regex.test(tag)))
      );
    });
  }

  // Fuse.js configuration for fuzzy search
  const options = {
    includeScore: true,
    keys: ['name', 'description', 'tags'],
    threshold: 0.4,
  };

  const fuse = new Fuse(finalResults, options);

  // If a search query is provided, perform fuzzy search
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

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

