const axios = require('axios');

const RAILWAY_API_URL = 'https://backboard.railway.app/graphql/v2';
const API_KEY = process.env.RAILWAY_API_KEY;
const PROJECT_ID = process.env.RAILWAY_PROJECT_ID;

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
    const query = `
      query {
        project(id: "${PROJECT_ID}") {
          deployments(first: 1) {
            edges {
              node {
                id
                status
                createdAt
                staticUrl
                meta
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

    const deployment = response.data.data.project.deployments.edges[0]?.node;
    
    if (!deployment) {
      return { status: 'NO_DEPLOYMENTS', message: 'No deployments found' };
    }

    let error = null;
    if (deployment.status === 'FAILED' || deployment.status === 'CRASHED') {
      error = await getDeploymentLogs(deployment.id);
    }

    return {
      id: deployment.id,
      status: deployment.status,
      createdAt: deployment.createdAt,
      url: deployment.staticUrl,
      error: error
    };
  } catch (error) {
    console.error('Railway API error:', error.response?.data || error.message);
    throw new Error('Failed to get deployment status from Railway');
  }
}

// Get deployment logs (for error details)
async function getDeploymentLogs(deploymentId) {
  try {
    const query = `
      query {
        deploymentLogs(deploymentId: "${deploymentId}", limit: 100) {
          message
          timestamp
        }
      }
    `;

    const response = await api.post('', { query });
    
    if (response.data.errors) {
      return 'Unable to fetch error logs';
    }

    const logs = response.data.data.deploymentLogs;
    
    // Filter for error messages
    const errorLogs = logs
      .filter(log => 
        log.message.toLowerCase().includes('error') || 
        log.message.toLowerCase().includes('failed') ||
        log.message.toLowerCase().includes('exception')
      )
      .map(log => log.message)
      .join('\n');

    return errorLogs || 'Deployment failed but no specific error found in logs';
  } catch (error) {
    return 'Unable to fetch deployment logs';
  }
}

module.exports = {
  getDeploymentStatus
};
