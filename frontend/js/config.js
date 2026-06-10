const apiBaseUrl = window.location.port === "5500"
  ? "http://localhost/consulta-componente/api"
  : `${window.location.origin}/api`;

window.APP_CONFIG = {
  COMPONENTS_API_URL: `${apiBaseUrl}/componentes.php`,
  IMPORT_API_URL: `${apiBaseUrl}/importar-componentes.php`
};
