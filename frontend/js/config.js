const appRootPath = window.location.pathname.includes("/frontend/")
  ? `${window.location.pathname.split("/frontend/")[0]}/`
  : "/";
const appRootUrl = window.location.port === "5500"
  ? "http://localhost/consulta-componente/"
  : `${window.location.origin}${appRootPath}`;
const apiBaseUrl = window.location.port === "5500"
  ? "http://localhost/consulta-componente/api"
  : `${appRootUrl}api`;

window.APP_CONFIG = {
  ROOT_URL: appRootUrl,
  COMPONENTS_API_URL: `${apiBaseUrl}/componentes.php`,
  IMPORT_API_URL: `${apiBaseUrl}/importar-componentes.php`
};
