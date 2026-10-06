const languages = { vi: "Vietnamese", en: "English", ja: "Japanese", fr: "French", ko: "Korean", es: "Spanish" };

export function agentLanguageInstruction(language) {
  const name = Object.hasOwn(languages, language) ? languages[language] : languages.vi;
  return `Respond to the user in ${name}. Use this language for the current response even if earlier messages use another language. Keep tool names, IDs and JSON keys unchanged.`;
}
