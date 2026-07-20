const appRootPath = window.location.pathname.includes("/frontend/")
  ? `${window.location.pathname.split("/frontend/")[0]}/`
  : "/";
const appRootUrl = `${window.location.origin}${appRootPath}`;
const apiBaseUrl = `${appRootUrl}api`;

window.APP_CONFIG = {
  ROOT_URL: appRootUrl,
  ME_API_URL: `${apiBaseUrl}/me`,
  LOGIN_API_URL: `${apiBaseUrl}/login`,
  LOGOUT_API_URL: `${apiBaseUrl}/logout`,
  COMPONENTS_API_URL: `${apiBaseUrl}/componentes`,
  IMPORT_API_URL: `${apiBaseUrl}/importar-componentes`
};
