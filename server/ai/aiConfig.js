/**
 * AI Configuration
 * Reads from environment variables to avoid committing secrets to git.
 *
 * Required environment variables:
 * - AI_LLM_BASE_URL: Azure OpenAI endpoint (e.g., https://your-resource.openai.azure.com)
 * - AI_LLM_API_KEY: Azure OpenAI API key
 * - AI_LLM_MODEL: Model name (default: gpt-5.2)
 *
 * Optional:
 * - AI_LLM_API_VERSION: API version (default: 2024-12-01-preview)
 * - AI_LLM_LOG: Set to '1' to enable LLM request/response logging
 */
module.exports = {
  endpoint: process.env.AI_LLM_BASE_URL,
  apiKey: process.env.AI_LLM_API_KEY,
  apiVersion: process.env.AI_LLM_API_VERSION || '2024-12-01-preview',
  model: process.env.AI_LLM_MODEL || 'gpt-5.2',
};
