export function validateSchema(schema, input, path = "") {
  const errors = [];
  const currentPath = path || "input";

  if (!schema || typeof schema !== "object") {
    return { valid: true, errors };
  }

  if (schema.type === "object") {
    if (input == null || typeof input !== "object" || Array.isArray(input)) {
      errors.push(`${currentPath} must be an object`);
      return { valid: false, errors };
    }

    const required = schema.required ?? [];
    required.forEach((key) => {
      if (!(key in input)) {
        errors.push(`${currentPath}.${key} is required`);
      }
    });

    const properties = schema.properties ?? {};
    Object.entries(properties).forEach(([key, childSchema]) => {
      if (!(key in input)) return;
      const child = input[key];
      const result = validateSchema(childSchema, child, `${currentPath}.${key}`);
      if (!result.valid) {
        errors.push(...result.errors);
      }
    });

    return { valid: errors.length === 0, errors };
  }

  if (schema.type === "array") {
    if (!Array.isArray(input)) {
      errors.push(`${currentPath} must be an array`);
      return { valid: false, errors };
    }

    if (schema.maxItems != null && input.length > schema.maxItems) {
      errors.push(`${currentPath} must have at most ${schema.maxItems} items`);
    }

    if (schema.minItems != null && input.length < schema.minItems) {
      errors.push(`${currentPath} must have at least ${schema.minItems} items`);
    }

    const itemSchema = schema.items;
    if (itemSchema) {
      input.forEach((item, index) => {
        const result = validateSchema(itemSchema, item, `${currentPath}[${index}]`);
        if (!result.valid) {
          errors.push(...result.errors);
        }
      });
    }

    return { valid: errors.length === 0, errors };
  }

  if (schema.type === "string") {
    if (typeof input !== "string") {
      errors.push(`${currentPath} must be a string`);
      return { valid: false, errors };
    }
    if (schema.maxLength != null && input.length > schema.maxLength) {
      errors.push(`${currentPath} must be at most ${schema.maxLength} characters`);
    }
    if (schema.minLength != null && input.length < schema.minLength) {
      errors.push(`${currentPath} must be at least ${schema.minLength} characters`);
    }
  }

  if (schema.type === "number") {
    if (typeof input !== "number" || Number.isNaN(input)) {
      errors.push(`${currentPath} must be a number`);
      return { valid: false, errors };
    }
    if (schema.min != null && input < schema.min) {
      errors.push(`${currentPath} must be at least ${schema.min}`);
    }
    if (schema.max != null && input > schema.max) {
      errors.push(`${currentPath} must be at most ${schema.max}`);
    }
  }

  if (schema.type === "integer") {
    if (!Number.isInteger(input)) {
      errors.push(`${currentPath} must be an integer`);
      return { valid: false, errors };
    }
    if (schema.min != null && input < schema.min) {
      errors.push(`${currentPath} must be at least ${schema.min}`);
    }
    if (schema.max != null && input > schema.max) {
      errors.push(`${currentPath} must be at most ${schema.max}`);
    }
  }

  if (schema.type === "boolean") {
    if (typeof input !== "boolean") {
      errors.push(`${currentPath} must be a boolean`);
      return { valid: false, errors };
    }
  }

  if (schema.enum && !schema.enum.includes(input)) {
    errors.push(`${currentPath} must be one of ${schema.enum.join(", ")}`);
  }

  return { valid: errors.length === 0, errors };
}
