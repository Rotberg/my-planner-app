import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Save data to AsyncStorage
 * @param {string} key - The storage key
 * @param {any} value - The value to store (will be JSON stringified)
 * @returns {Promise<void>}
 */
export const saveToStorage = async (key, value) => {
  try {
    const jsonValue = JSON.stringify(value);
    await AsyncStorage.setItem(key, jsonValue);
  } catch (error) {
    console.error(`Error saving ${key} to storage:`, error);
  }
};

/**
 * Retrieve data from AsyncStorage
 * @param {string} key - The storage key
 * @returns {Promise<any>} The stored value or null if not found
 */
export const getFromStorage = async (key) => {
  try {
    const jsonValue = await AsyncStorage.getItem(key);
    return jsonValue != null ? JSON.parse(jsonValue) : null;
  } catch (error) {
    console.error(`Error retrieving ${key} from storage:`, error);
    return null;
  }
};

/**
 * Remove data from AsyncStorage
 * @param {string} key - The storage key
 * @returns {Promise<void>}
 */
export const removeFromStorage = async (key) => {
  try {
    await AsyncStorage.removeItem(key);
  } catch (error) {
    console.error(`Error removing ${key} from storage:`, error);
  }
};

/**
 * Clear all data from AsyncStorage
 * @returns {Promise<void>}
 */
export const clearStorage = async () => {
  try {
    await AsyncStorage.clear();
  } catch (error) {
    console.error('Error clearing storage:', error);
  }
};

/**
 * Get all keys from AsyncStorage
 * @returns {Promise<string[]>} Array of all storage keys
 */
export const getAllStorageKeys = async () => {
  try {
    const keys = await AsyncStorage.getAllKeys();
    return keys;
  } catch (error) {
    console.error('Error getting storage keys:', error);
    return [];
  }
};
