/**
 * Utility functions for handling Firebase Storage URLs across different environments
 */

/**
 * Transforms Firebase Storage URLs to work properly in both development and production
 * @param {string} imageUrl - The original Firebase Storage URL
 * @returns {string} - The properly formatted URL for the current environment
 */
export const getImageUrl = (imageUrl) => {
  if (!imageUrl) return imageUrl;
  
  // Check if we're in development (localhost or local IP) where Vite proxy works
  const isDevelopment = 
    window.location.hostname === 'localhost' || 
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname.startsWith('192.168.') ||
    window.location.hostname.startsWith('10.') ||
    window.location.port !== '';
  
  // If it's a Firebase Storage URL and we're in development, use proxy
  if (imageUrl.includes('firebasestorage.googleapis.com') && isDevelopment) {
    return `/firebase-storage${imageUrl.split('firebasestorage.googleapis.com')[1]}`;
  }
  
  // For production or non-Firebase URLs, return the original URL
  return imageUrl;
};

/**
 * Fetches an image with proper URL handling for the current environment
 * @param {string} imageUrl - The Firebase Storage URL
 * @returns {Promise<Response>} - The fetch response
 */
export const fetchImage = async (imageUrl) => {
  const processedUrl = getImageUrl(imageUrl);
  
  try {
    const response = await fetch(processedUrl);
    return response;
  } catch (error) {
    // If proxy fails in development, try the direct URL as fallback
    if (processedUrl !== imageUrl) {
      console.warn(`Proxy fetch failed, trying direct URL:`, error);
      return await fetch(imageUrl);
    }
    throw error;
  }
};

/**
 * Converts an image URL to base64 data
 * @param {string} imageUrl - The Firebase Storage URL
 * @returns {Promise<string>} - Base64 data (without data URL prefix)
 */
export const imageUrlToBase64 = async (imageUrl) => {
  const response = await fetchImage(imageUrl);
  
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
  }
  
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result;
      // Remove the data URL prefix (e.g., "data:image/jpeg;base64,")
      const base64Data = result.split(',')[1];
      resolve(base64Data);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}; 