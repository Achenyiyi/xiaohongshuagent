export function setIfFieldExists(
  target: Record<string, unknown>,
  fieldTypeMap: Map<string, number>,
  fieldName: string,
  value: unknown
) {
  if (fieldTypeMap.has(fieldName)) {
    target[fieldName] = value;
  }
}

export function setIfFieldHasValue(
  target: Record<string, unknown>,
  fieldTypeMap: Map<string, number>,
  fieldName: string,
  value: unknown
) {
  if (!fieldTypeMap.has(fieldName)) return;
  if (value === undefined || value === null) return;

  if (typeof value === "string") {
    const normalized = value.trim();
    if (!normalized) return;
    target[fieldName] = normalized;
    return;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return;
    target[fieldName] = value;
    return;
  }

  target[fieldName] = value;
}
