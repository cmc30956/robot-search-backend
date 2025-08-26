// server.js
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const Fuse = require('fuse.js'); // 用于实现模糊搜索

const app = express();
const PORT = process.env.PORT || 3001;

// 使用 CORS 中间件来允许跨域请求
app.use(cors());

// GitHub API 的基本 URL
const GITHUB_API_URL = 'https://api.github.com/search/repositories';

// Hugging Face API 的基本 URL
const HUGGING_FACE_API_URL = 'https://huggingface.co/api/models';

/**
 * 将 GitHub 项目数据标准化为统一的格式。
 * @param {object} item - GitHub API 返回的单个项目。
 * @returns {object} - 标准化后的项目对象。
 */
const standardizeGithubProject = (item) => ({
  id: item.id,
  name: item.full_name,
  description: item.description,
  url: item.html_url,
  source: 'GitHub',
  tags: item.topics || [], // 使用 topics 作为标签
  stars: item.stargazers_count,
});

/**
 * 将 Hugging Face 模型数据标准化为统一的格式。
 * @param {object} item - Hugging Face API 返回的单个模型。
 * @returns {object} - 标准化后的模型对象。
 */
const standardizeHuggingFaceModel = (item) => ({
  id: item.id,
  name: item.modelId,
  description: item.pipeline_tag, // 使用 pipeline_tag 作为描述
  url: `https://huggingface.co/${item.modelId}`,
  source: 'Hugging Face',
  tags: item.tags || [],
  downloads: item.downloads,
});

/**
 * 主搜索 API 端点。
 */
app.get('/api/search', async (req, res) => {
  const { query, source, tags } = req.query;

  let allResults = [];
  const searchPromises = [];

  // 如果请求来自 GitHub 或所有来源
  if (source === 'All' || source === 'GitHub') {
    // 构造 GitHub API 请求，使用更灵活的搜索查询
    searchPromises.push(
      axios.get(GITHUB_API_URL, {
        params: {
          // 不再使用硬性的 'topic:robotics'，而是将它作为关键词的一部分
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

  // 如果请求来自 Hugging Face 或所有来源
  if (source === 'All' || source === 'Hugging Face') {
    // 构造 Hugging Face API 请求，并使用相关的流水线标签进行过滤
    searchPromises.push(
      axios.get(HUGGING_FACE_API_URL, {
        params: {
          search: `${query || ''}`,
          sort: 'downloads',
          limit: 50,
          // 保持与机器人相关的流水线标签
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

  // 等待所有 API 请求完成
  await Promise.allSettled(searchPromises);

  // Fuse.js 配置，用于模糊搜索
  const options = {
    includeScore: true,
    keys: ['name', 'description', 'tags'],
    threshold: 0.4, // 调整阈值以控制模糊匹配的宽松程度
  };

  const fuse = new Fuse(allResults, options);
  let finalResults = allResults;

  // 如果有搜索词，则执行模糊搜索
  if (query) {
    const fuseResults = fuse.search(query);
    finalResults = fuseResults.map(result => result.item);
  }

  // 如果有标签筛选，则进行筛选
  if (tags && tags.length > 0) {
    const selectedTagsArray = tags.split(',');
    finalResults = finalResults.filter(project =>
      project.tags && project.tags.some(tag => selectedTagsArray.includes(tag))
    );
  }

  // 按 stars/downloads 降序排列
  finalResults.sort((a, b) => {
    const scoreA = a.stars || a.downloads || 0;
    const scoreB = b.stars || b.downloads || 0;
    return scoreB - scoreA;
  });

  res.json(finalResults);
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

