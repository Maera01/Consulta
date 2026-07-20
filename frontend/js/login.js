const loginForm = document.querySelector("#login-form");
const loginError = document.querySelector("#login-error");

fetch(window.APP_CONFIG.ME_API_URL, { credentials: "same-origin" })
  .then((response) => response.ok ? response.json() : null)
  .then((data) => {
    if (data?.authenticated) {
      window.location.href = `${window.APP_CONFIG.ROOT_URL}frontend/`;
    }
  })
  .catch(() => {});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginError.hidden = true;

  const button = loginForm.querySelector("button");
  button.disabled = true;
  button.textContent = "Entrando...";

  try {
    const response = await fetch(window.APP_CONFIG.LOGIN_API_URL, {
      method: "POST",
      body: new URLSearchParams(new FormData(loginForm)),
      credentials: "same-origin",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Login ou senha inválidos.");
    window.location.href = `${window.APP_CONFIG.ROOT_URL}frontend/`;
  } catch (error) {
    loginError.textContent = error.message || "Não foi possível fazer login.";
    loginError.hidden = false;
  } finally {
    button.disabled = false;
    button.textContent = "Entrar";
  }
});
