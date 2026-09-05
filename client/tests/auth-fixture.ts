// Feature-component tests run after authentication and use the real API wrapper.
export function seedCsrfCookie() {
  document.cookie = `hoi4_csrf=${"c".repeat(43)}; Path=/; SameSite=Lax`;
}
