const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
const port = 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Example data from GitHub and Hugging Face to simulate API responses.
// In a real-world scenario, you would dynamically fetch this data.
const githubProjects = [
  { id: 1, full_name: 'alphabot', description: 'A versatile mobile robot platform.', topics: ['robotic-arm', 'C++', 'hardware'] },
  { id: 2, full_name: 'ROS2', description: 'The next generation of the Robot Operating System.', topics: ['ROS2', 'navigation', 'autonomous'] },
  { id: 3, full_name: 'OpenCV-Bot', description: 'An educational robot project using OpenCV for computer vision.', topics: ['computer-vision', 'Python', 'OpenCV'] },
  { id: 4, full_name: 'A-star-Rust', description: 'An efficient A* pathfinding algorithm implementation in Rust.', topics: ['pathfinding', 'Rust', 'algorithm'] },
  { id: 5, full_name: 'Panda-Robotics', description: 'A framework for robotic arm simulation and control.', topics: ['robotic-arm', 'simulation', 'manipulation'] },
  { id: 6, full_name: 'Robot-Locomotion', description: 'Research code for bipedal robot locomotion.', topics: ['locomotion', 'bipedal', 'control'] },
  { id: 7, full_name: 'PyRobot', description: 'A PyTorch-based robotics research platform.', topics: ['robotic-arm', 'learning', 'Python'] }
];

const huggingfaceModels = [
  { id: 101, modelId: 'RoboGPT', description: 'A large language model fine-tuned for robotic commands.', tags: ['NLP', 'AI', 'language-model'] },
  { id: 102, modelId: 'DuoQuad', description: 'A reinforcement learning model for quadcopter control.', tags: ['reinforcement-learning', 'AI', 'quadcopter'] },
  { id: 103, modelId: 'Mobile-Robotics', description: 'A vision-based model for mobile robot navigation.', tags: ['navigation', 'SLAM', 'AI'] }
];

// Combine all projects into a single array with a unified structure
const allProjects = [
  ...githubProjects.map(p => ({
    id: `gh-${p.id}`,
    name: p.full_name,
    description: p.description,
    tags: p.topics,
    source: 'GitHub',
    url: `https://github.com/${p.full_name}`
  })),
  ...huggingfaceModels.map(m => ({
    id: `hf-${m.id}`,
    name: m.modelId,
    description: m.description,
    tags: m.tags,
    source: 'Hugging Face',
    url: `https://huggingface.co/${m.modelId}`
  }))
];

// Search API endpoint
app.get('/api/search', async (req, res) => {
  const { query, source, tags } = req.query;
  let filtered = [...allProjects];

  // Filter by source (GitHub, Hugging Face, or all)
  if (source && source !== 'All') {
    filtered = filtered.filter(p => p.source === source);
  }

  // Filter by tags
  if (tags) {
    const selectedTags = tags.split(',').map(tag => tag.toLowerCase().trim());
    filtered = filtered.filter(p => p.tags.some(tag => selectedTags.includes(tag.toLowerCase())));
  }

  // Filter by query (case-insensitive search in name and description)
  if (query) {
    const lowerQuery = query.toLowerCase();
    filtered = filtered.filter(p =>
      p.name.toLowerCase().includes(lowerQuery) ||
      p.description.toLowerCase().includes(lowerQuery)
    );
  }

  res.json(filtered);
});

// Serve a basic message for the root URL
app.get('/', (req, res) => {
  res.send('Backend server is running.');
});

// The server starts listening on the port provided by the hosting environment or a default port.
app.listen(process.env.PORT || port, () => {
  console.log(`Backend server running on port ${process.env.PORT || port}`);
});

