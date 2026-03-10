export const requirePasswordStrength = (password) => {
  const raw = String(password || "");
  if (raw.length < 8) {
    return {
      valid: false,
      error: "Password must be at least 8 characters long",
    };
  }
  return { valid: true };
};
