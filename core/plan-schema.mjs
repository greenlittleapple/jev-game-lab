// Validator for the subset of JSON Schema that strategist plan schemas use.
// Adapted from validatePlan in jev-spire-strategist (integration/sts2/strategy.mjs): the schema is
// an argument, and ranges and list limits are declared in the schema instead of game code.
// Keywords: type (object, array, string, integer, number, boolean), required, properties,
// additionalProperties (only `true` allows unknown keys), items, enum, minimum, maximum,
// minItems, maxItems, maxLength, pattern.
export function validatePlan(value, schema, path = 'plan') {
 const errors = [];
 if (schema.type === 'object') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [path + ' must be an object'];
  for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) errors.push(path + '.' + key + ' is required');
  for (const key of Object.keys(value)) {
   const sub = schema.properties?.[key];
   if (sub) errors.push(...validatePlan(value[key], sub, path + '.' + key));
   else if (schema.additionalProperties !== true) errors.push(path + '.' + key + ' is not allowed');
  }
  return errors;
 }
 if (schema.type === 'array') {
  if (!Array.isArray(value)) return [path + ' must be an array'];
  if (Number.isInteger(schema.maxItems) && value.length > schema.maxItems) errors.push(path + ' allows at most ' + schema.maxItems + ' entries');
  if (Number.isInteger(schema.minItems) && value.length < schema.minItems) errors.push(path + ' needs at least ' + schema.minItems + ' entries');
  if (schema.items) value.forEach((v, n) => errors.push(...validatePlan(v, schema.items, path + '[' + n + ']')));
  return errors;
 }
 if (schema.type === 'integer' && !Number.isSafeInteger(value)) return [path + ' must be an integer'];
 if (schema.type === 'number' && !Number.isFinite(value)) return [path + ' must be a number'];
 if (schema.type === 'boolean' && typeof value !== 'boolean') return [path + ' must be a boolean'];
 if (schema.type === 'string') {
  if (typeof value !== 'string') return [path + ' must be a string'];
  if (Number.isInteger(schema.maxLength) && value.length > schema.maxLength) errors.push(path + ' is longer than ' + schema.maxLength + ' characters');
  if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(path + ' must match ' + schema.pattern);
 }
 if (schema.enum && !schema.enum.includes(value)) errors.push(path + ' must be one of ' + schema.enum.join(', '));
 if (typeof value === 'number') {
  if (Number.isFinite(schema.minimum) && value < schema.minimum) errors.push(path + ' must be at least ' + schema.minimum);
  if (Number.isFinite(schema.maximum) && value > schema.maximum) errors.push(path + ' must be at most ' + schema.maximum);
 }
 return errors;
}
