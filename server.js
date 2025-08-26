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
 * Main search API endpoint.
 */
app.get('/api/search', async (req, res) => {
  const { query, source, tags, sort } = req.query;

  let allResults = [];
  const searchPromises = [];

  // If the request is for GitHub or all sources
  if (source === 'All' || source === 'GitHub') {
    // Construct the GitHub API request with a more flexible search query
    searchPromises.push(
      axios.get(GITHUB_API_URL, {
        params: {
          q: `${query || ''} robotics`,
          sort: 'stars',
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
    // Construct the Hugging Face API request with relevant pipeline tags
    searchPromises.push(
      axios.get(HUGGING_FACE_API_URL, {
        params: {
          search: `${query || ''}`,
          sort: 'downloads',
          limit: 50,
          pipeline_tag: 'reinforcement-learning|computer-vision|text-to-speech|automatic-speech-recognition|visual-question-answering'
        },
      })
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

  // Fuse.js configuration for fuzzy search
  const options = {
    includeScore: true,
    keys: ['name', 'description', 'tags'],
    threshold: 0.4, // Adjust threshold for looseness of fuzzy matching
  };

  const fuse = new Fuse(allResults, options);
  let finalResults = allResults;

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

  // Sort logic based on the 'sort' parameter
  if (sort === 'growth') {
    // A simple, efficient proxy for growth is sorting by total stars/downloads
    finalResults.sort((a, b) => {
      const scoreA = a.stars || a.downloads || 0;
      const scoreB = b.stars || b.downloads || 0;
      return scoreB - scoreA;
    });
  } else {
    // Default sorting by stars/downloads in descending order
    finalResults.sort((a, b) => {
      const scoreA = a.stars || a.downloads || 0;
      const scoreB = b.stars || b.downloads || 0;
      return scoreB - scoreA;
    });
  }

  res.json(finalResults);
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

