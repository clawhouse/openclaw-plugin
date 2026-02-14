/**
 * Comprehensive configuration validation utilities for ClawHouse plugin.
 * Handles edge cases in config parsing and provides descriptive error messages.
 */

export interface ConfigValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface ConfigValidationOptions {
  strictMode?: boolean;
  allowLocalhost?: boolean;
  requireHttps?: boolean;
}

/**
 * Validates a complete ClawHouse configuration object
 */
export function validateClawHouseConfig(
  config: unknown,
  options: ConfigValidationOptions = {}
): ConfigValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const opts = {
    strictMode: true,
    allowLocalhost: false,
    requireHttps: true,
    ...options,
  };

  // Handle null/undefined config
  if (config == null) {
    errors.push('Configuration is null or undefined');
    return { isValid: false, errors, warnings };
  }

  // Handle non-object config
  if (typeof config !== 'object') {
    errors.push(`Configuration must be an object, got ${typeof config}`);
    return { isValid: false, errors, warnings };
  }

  // Handle empty object
  if (Object.keys(config as object).length === 0) {
    warnings.push('Configuration is empty - plugin will not be functional');
  }

  const cfg = config as Record<string, unknown>;
  
  // Validate channels structure
  if (cfg.channels != null) {
    if (typeof cfg.channels !== 'object') {
      errors.push('channels must be an object if provided');
    } else {
      const channels = cfg.channels as Record<string, unknown>;
      if (channels.clawhouse != null) {
        const clawHouseErrors = validateClawHouseChannelConfig(
          channels.clawhouse,
          'channels.clawhouse',
          opts
        );
        errors.push(...clawHouseErrors.errors);
        warnings.push(...clawHouseErrors.warnings);
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validates a ClawHouse channel configuration
 */
function validateClawHouseChannelConfig(
  config: unknown,
  path: string,
  options: ConfigValidationOptions
): ConfigValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (config == null) {
    errors.push(`${path} is null or undefined`);
    return { isValid: false, errors, warnings };
  }

  if (typeof config !== 'object') {
    errors.push(`${path} must be an object, got ${typeof config}`);
    return { isValid: false, errors, warnings };
  }

  const cfg = config as Record<string, unknown>;

  // Check for required fields
  const requiredFields = ['botToken', 'apiUrl', 'wsUrl', 'userId'];
  const missingFields = requiredFields.filter(field => {
    const value = cfg[field];
    return value == null || (typeof value === 'string' && value.trim() === '');
  });

  if (missingFields.length > 0) {
    errors.push(`${path} is missing required fields: ${missingFields.join(', ')}`);
  }

  // Validate individual fields
  const botTokenResult = validateBotToken(cfg.botToken, `${path}.botToken`);
  const apiUrlResult = validateApiUrl(cfg.apiUrl, `${path}.apiUrl`, options);
  const wsUrlResult = validateWsUrl(cfg.wsUrl, `${path}.wsUrl`, options);
  const userIdResult = validateUserId(cfg.userId, `${path}.userId`);

  errors.push(...botTokenResult.errors, ...apiUrlResult.errors, ...wsUrlResult.errors, ...userIdResult.errors);
  warnings.push(...botTokenResult.warnings, ...apiUrlResult.warnings, ...wsUrlResult.warnings, ...userIdResult.warnings);

  // Validate enabled field
  if (cfg.enabled != null && typeof cfg.enabled !== 'boolean') {
    if (typeof cfg.enabled === 'string') {
      const lower = cfg.enabled.toLowerCase().trim();
      if (!['true', 'false', '1', '0'].includes(lower)) {
        errors.push(`${path}.enabled must be a boolean or boolean string ("true"/"false"), got: ${cfg.enabled}`);
      }
    } else {
      errors.push(`${path}.enabled must be a boolean, got ${typeof cfg.enabled}`);
    }
  }

  // Validate accounts if present
  if (cfg.accounts != null) {
    if (typeof cfg.accounts !== 'object') {
      errors.push(`${path}.accounts must be an object if provided`);
    } else {
      const accounts = cfg.accounts as Record<string, unknown>;
      for (const [accountId, accountConfig] of Object.entries(accounts)) {
        if (!/^[a-zA-Z0-9_-]+$/.test(accountId)) {
          errors.push(`${path}.accounts.${accountId}: account ID contains invalid characters`);
        }
        
        const accountResult = validateClawHouseChannelConfig(
          accountConfig,
          `${path}.accounts.${accountId}`,
          options
        );
        errors.push(...accountResult.errors);
        warnings.push(...accountResult.warnings);
      }
    }
  }

  return { isValid: errors.length === 0, errors, warnings };
}

/**
 * Validates bot token format and security
 */
function validateBotToken(value: unknown, path: string): ConfigValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (value == null) {
    errors.push(`${path} is required`);
    return { isValid: false, errors, warnings };
  }

  if (typeof value !== 'string') {
    errors.push(`${path} must be a string, got ${typeof value}`);
    return { isValid: false, errors, warnings };
  }

  const token = value.trim();
  
  if (token !== value) {
    warnings.push(`${path} has leading or trailing whitespace`);
  }

  if (token === '') {
    errors.push(`${path} cannot be empty`);
    return { isValid: false, errors, warnings };
  }

  if (!token.startsWith('bot_')) {
    errors.push(`${path} must start with "bot_"`);
    return { isValid: false, errors, warnings };
  }

  if (token.length < 15) {
    errors.push(`${path} appears too short (minimum 15 characters for security)`);
  }

  if (token.length > 100) {
    errors.push(`${path} appears too long (maximum 100 characters)`);
  }

  if (!/^bot_[a-zA-Z0-9_-]+$/.test(token)) {
    errors.push(`${path} contains invalid characters (only alphanumeric, underscore, and dash allowed after "bot_")`);
  }

  // Security checks
  if (token === 'bot_test' || token === 'bot_example' || token === 'bot_dummy') {
    warnings.push(`${path} appears to be a placeholder value`);
  }

  if (token.length < 32) {
    warnings.push(`${path} is shorter than recommended for production use (32+ characters)`);
  }

  return { isValid: errors.length === 0, errors, warnings };
}

/**
 * Validates API URL format, reachability, and security
 */
function validateApiUrl(value: unknown, path: string, options: ConfigValidationOptions): ConfigValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (value == null) {
    errors.push(`${path} is required`);
    return { isValid: false, errors, warnings };
  }

  if (typeof value !== 'string') {
    errors.push(`${path} must be a string, got ${typeof value}`);
    return { isValid: false, errors, warnings };
  }

  const url = value.trim();
  
  if (url !== value) {
    warnings.push(`${path} has leading or trailing whitespace`);
  }

  if (url === '') {
    errors.push(`${path} cannot be empty`);
    return { isValid: false, errors, warnings };
  }

  try {
    const parsed = new URL(url);
    
    // Protocol validation
    if (options.requireHttps && parsed.protocol !== 'https:') {
      if (options.strictMode) {
        errors.push(`${path} must use HTTPS protocol for security`);
      } else {
        warnings.push(`${path} should use HTTPS protocol for production use`);
      }
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      errors.push(`${path} must use HTTP or HTTPS protocol, got ${parsed.protocol}`);
    }

    // Hostname validation
    if (!parsed.hostname) {
      errors.push(`${path} must have a valid hostname`);
    } else if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
      if (!options.allowLocalhost) {
        if (options.strictMode) {
          errors.push(`${path} cannot use localhost (use a publicly accessible URL)`);
        } else {
          warnings.push(`${path} uses localhost - this may not work in production`);
        }
      }
    } else if (parsed.hostname.startsWith('192.168.') || parsed.hostname.startsWith('10.')) {
      warnings.push(`${path} uses a private IP address - ensure it's reachable from your deployment`);
    }

    // Port validation
    if (parsed.port) {
      const portNum = parseInt(parsed.port, 10);
      if (portNum < 1 || portNum > 65535) {
        errors.push(`${path} has invalid port number: ${parsed.port}`);
      }
    }

    // Path validation
    if (parsed.pathname && !parsed.pathname.endsWith('/')) {
      warnings.push(`${path} path should end with "/" for consistency`);
    }

    // Common typos and issues
    if (url.includes('//api') && !url.includes('://')) {
      warnings.push(`${path} may have a typo (double slash without protocol)`);
    }

    if (url.includes(' ')) {
      errors.push(`${path} cannot contain spaces`);
    }

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid URL format';
    errors.push(`${path} is not a valid URL: ${message}`);
  }

  return { isValid: errors.length === 0, errors, warnings };
}

/**
 * Validates WebSocket URL format and security
 */
function validateWsUrl(value: unknown, path: string, options: ConfigValidationOptions): ConfigValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (value == null) {
    errors.push(`${path} is required`);
    return { isValid: false, errors, warnings };
  }

  if (typeof value !== 'string') {
    errors.push(`${path} must be a string, got ${typeof value}`);
    return { isValid: false, errors, warnings };
  }

  const url = value.trim();
  
  if (url !== value) {
    warnings.push(`${path} has leading or trailing whitespace`);
  }

  if (url === '') {
    errors.push(`${path} cannot be empty`);
    return { isValid: false, errors, warnings };
  }

  try {
    const parsed = new URL(url);
    
    // Protocol validation
    if (!['ws:', 'wss:'].includes(parsed.protocol)) {
      errors.push(`${path} must use ws:// or wss:// protocol, got ${parsed.protocol}`);
    } else if (parsed.protocol === 'ws:' && !options.allowLocalhost) {
      warnings.push(`${path} uses unencrypted WebSocket (ws://). Consider using wss:// for security`);
    }

    // Hostname validation
    if (!parsed.hostname) {
      errors.push(`${path} must have a valid hostname`);
    } else if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
      if (!options.allowLocalhost) {
        if (options.strictMode) {
          errors.push(`${path} cannot use localhost (use a publicly accessible URL)`);
        } else {
          warnings.push(`${path} uses localhost - this may not work in production`);
        }
      }
    }

    // Port validation
    if (parsed.port) {
      const portNum = parseInt(parsed.port, 10);
      if (portNum < 1 || portNum > 65535) {
        errors.push(`${path} has invalid port number: ${parsed.port}`);
      }
    }

    if (url.includes(' ')) {
      errors.push(`${path} cannot contain spaces`);
    }

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid URL format';
    errors.push(`${path} is not a valid WebSocket URL: ${message}`);
  }

  return { isValid: errors.length === 0, errors, warnings };
}

/**
 * Validates ClawHouse User ID format
 */
function validateUserId(value: unknown, path: string): ConfigValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (value == null) {
    errors.push(`${path} is required`);
    return { isValid: false, errors, warnings };
  }

  if (typeof value !== 'string') {
    errors.push(`${path} must be a string, got ${typeof value}`);
    return { isValid: false, errors, warnings };
  }

  const userId = value.trim().toUpperCase();
  
  if (userId !== value.toUpperCase()) {
    warnings.push(`${path} should be uppercase and not have leading or trailing whitespace`);
  }

  if (userId === '') {
    errors.push(`${path} cannot be empty`);
    return { isValid: false, errors, warnings };
  }

  // ClawHouse ID format: One letter (U/B/P/T) + 10 alphanumeric characters
  if (!/^[UBPT][A-Z0-9]{10}$/.test(userId)) {
    const prefix = userId.charAt(0);
    if (!'UBPT'.includes(prefix)) {
      errors.push(`${path} must start with U, B, P, or T (got: ${prefix})`);
    } else if (userId.length !== 11) {
      errors.push(`${path} must be exactly 11 characters long (got: ${userId.length})`);
    } else {
      errors.push(`${path} must match format: one letter (U/B/P/T) + 10 alphanumeric characters (e.g. U9QF3C6X1A)`);
    }
  }

  // Common mistakes
  if (userId === 'USER123456789' || userId === 'UEXAMPLE123') {
    warnings.push(`${path} appears to be a placeholder value`);
  }

  return { isValid: errors.length === 0, errors, warnings };
}

/**
 * Utility to safely parse JSON configuration with error handling
 */
export function safeParseConfig(jsonString: string): { config: unknown; error?: string } {
  if (typeof jsonString !== 'string') {
    return { config: null, error: 'Config input must be a string' };
  }

  if (jsonString.trim() === '') {
    return { config: null, error: 'Config string is empty' };
  }

  try {
    const config = JSON.parse(jsonString);
    return { config };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown JSON parsing error';
    return { config: null, error: `Invalid JSON: ${message}` };
  }
}

/**
 * Utility to deeply validate nested configuration objects
 */
export function validateNestedConfig(
  config: unknown,
  path: string[] = [],
  visitedObjects = new Set<unknown>()
): ConfigValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const currentPath = path.join('.');

  // Prevent infinite recursion from circular references
  if (config != null && typeof config === 'object' && visitedObjects.has(config)) {
    warnings.push(`Circular reference detected at ${currentPath}`);
    return { isValid: true, errors, warnings };
  }

  if (config != null && typeof config === 'object') {
    visitedObjects.add(config);
  }

  // Base case: validate primitive values
  if (config == null || typeof config !== 'object') {
    return { isValid: true, errors, warnings };
  }

  // Handle arrays
  if (Array.isArray(config)) {
    config.forEach((item, index) => {
      const result = validateNestedConfig(item, [...path, String(index)], visitedObjects);
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    });
    return { isValid: errors.length === 0, errors, warnings };
  }

  // Handle objects
  const obj = config as Record<string, unknown>;

  // Check for common typos in property names
  const knownProperties = ['channels', 'plugins', 'botToken', 'apiUrl', 'wsUrl', 'userId', 'enabled', 'accounts'];
  for (const prop of Object.keys(obj)) {
    if (!knownProperties.includes(prop)) {
      const similar = knownProperties.find(known => 
        Math.abs(known.length - prop.length) <= 2 &&
        known.toLowerCase().includes(prop.toLowerCase())
      );
      if (similar) {
        warnings.push(`${currentPath}.${prop}: unknown property, did you mean "${similar}"?`);
      }
    }
  }

  // Recursively validate object properties
  for (const [key, value] of Object.entries(obj)) {
    const result = validateNestedConfig(value, [...path, key], visitedObjects);
    errors.push(...result.errors);
    warnings.push(...result.warnings);
  }

  return { isValid: errors.length === 0, errors, warnings };
}