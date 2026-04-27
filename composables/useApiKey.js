// API key + base URL persistence. Stored in localStorage so the user only enters
// it once per browser. Nothing leaves the client.
const STORAGE_KEY = 'kuali_api_key';
const STORAGE_URL = 'kuali_base_url';
const DEFAULT_BASE = 'https://davidson.kualibuild.com';

export const useApiKey = () => {
  const apiKey = useState('apiKey', () => {
    if (import.meta.client) {
      return localStorage.getItem(STORAGE_KEY) || '';
    }
    return '';
  });

  const baseUrl = useState('baseUrl', () => {
    if (import.meta.client) {
      return localStorage.getItem(STORAGE_URL) || DEFAULT_BASE;
    }
    return DEFAULT_BASE;
  });

  const hasApiKey = computed(() => !!apiKey.value);

  // Session-scoped flash message for auth-related rejections (e.g. token
  // expired). Set by useGraphQL when upstream returns 401, read and cleared
  // by the connect form on the home page.
  const authError = useState('authError', () => null);

  const setApiKey = (key, url) => {
    apiKey.value = key;
    baseUrl.value = url || DEFAULT_BASE;
    if (import.meta.client) {
      localStorage.setItem(STORAGE_KEY, apiKey.value);
      localStorage.setItem(STORAGE_URL, baseUrl.value);
    }
  };

  const clearApiKey = () => {
    apiKey.value = '';
    baseUrl.value = DEFAULT_BASE;
    if (import.meta.client) {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(STORAGE_URL);
    }
  };

  return { apiKey, baseUrl, hasApiKey, authError, setApiKey, clearApiKey };
};
