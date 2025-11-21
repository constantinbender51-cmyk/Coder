const axios = require('axios');

const RAILWAY_API_URL = 'https://backboard.railway.app/graphql/v2';
const API_KEY = process.env.RAILWAY_API_KEY;
const PROJECT_ID = process.env.RAILWAY_TARGET_ID;

const api = axios.create({
  baseURL: RAILWAY_API_URL,
  headers: {
    'Authorization': `Bearer ${API_KEY}`,
    'Content-Type': 'application/json'
  }
});

// Get latest deployment status
async function getDeploymentStatus() {
  try {
    // Get latest deployment using string interpolation
    const query = `
      {
        deployments(input: {projectId: "${PROJECT_ID}"}, first: 1) {
          edges {
            node {
              id
              status
              createdAt
              staticUrl
              environment {
                name
              }
            }
          }
        }
      }
    `;

    const response = await api.post('', { query });
    
    if (response.data.errors) {
      throw new Error(response.data.errors[0].message);
    }

    const deployments = response.data.data.deployments.edges;
    
    if (!deployments || deployments.length === 0) {
      return { status: 'NO_DEPLOYMENTS', message: 'No deployments found' };
    }

    const deployment = deployments[0].node;
    
    let buildLogs = '';
    let deploymentLogs = '';
    
    // If deployment failed, get logs
    if (deployment.status === 'FAILED' || deployment.status === 'CRASHED') {
      buildLogs = await getBuildLogs(deployment.id);
      deploymentLogs = await getDeploymentLogs(deployment.id);
    }

    return {
      id: deployment.id,
      status: deployment.status,
      createdAt: deployment.createdAt,
      url: deployment.staticUrl,
      environment: deployment.environment?.name || 'unknown',
      buildLogs: buildLogs,
      deploymentLogs: deploymentLogs
    };
  } catch (error) {
    console.error('Railway API error:', error.response?.data || error.message);
    throw new Error('Failed to get deployment status from Railway');
  }
}

// Get build logs
async function getBuildLogs(deploymentId) {
  try {
    const query = `
      {
        buildLogs(deploymentId: "${deploymentId}", limit: 500) {
          message
          severity
          timestamp
        }
      }
    `;

    const response = await api.post('', { query });
    
    if (response.data.errors) {
      return 'Unable to fetch build logs';
    }

    const logs = response.data.data.buildLogs;
    
    if (!logs || logs.length === 0) {
      return 'No build logs available';
    }

    // Sort by timestamp and format
    const sortedLogs = logs.sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    const formattedLogs = sortedLogs
      .map(log => `${log.timestamp} [${log.severity}] ${log.message}`)
      .join('\n');

    return formattedLogs;
  } catch (error) {
    console.error('Error fetching build logs:', error.message);
    return 'Unable to fetch build logs';
  }
}

// Get deployment logs
async function getDeploymentLogs(deploymentId) {
  try {
    const query = `
      {
        deploymentLogs(deploymentId: "${deploymentId}", limit: 500) {
          message
          severity
          timestamp
        }
      }
    `;

    const response = await api.post('', { query });
    
    if (response.data.errors) {
      return 'Unable to fetch deployment logs';
    }

    const logs = response.data.data.deploymentLogs;
    
    if (!logs || logs.length === 0) {
      return 'No deployment logs available';
    }

    // Sort by timestamp and format
    const sortedLogs = logs.sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    const formattedLogs = sortedLogs
      .map(log => `${log.timestamp} [${log.severity}] ${log.message}`)
      .join('\n');

    return formattedLogs;
  } catch (error) {
    console.error('Error fetching deployment logs:', error.message);
    return 'Unable to fetch deployment logs';
  }
}

module.exports = {
  getDeploymentStatus
  getBuildLogs, 
  getDeploymentLogs, 
  // Add this export
  PROJECT_ID
};
