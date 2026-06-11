# Consulta de componentes

## Configuração local

1. No XAMPP, confirme que as extensões PHP `pdo_sqlite`, `zip`, `mbstring` e `simplexml` estão habilitadas.
2. Acesse `http://localhost/consulta-componente/frontend/`.

O banco local fica em `database/componentes.sqlite` e é criado automaticamente. Ao importar uma planilha, os dados são gravados nesse arquivo e ficam disponíveis na consulta.

A importação fica no final da página e exige a senha administrativa. O servidor armazena somente o hash da senha.

## Formato da planilha

A importação aceita o relatório `.xls` XML exportado pelo sistema, além de `.xlsx` e `.csv`, com até 10 MB e 20.000 componentes.

No relatório do sistema, o cabeçalho útil é localizado automaticamente e as colunas são mapeadas assim:

- `# Prod.` → código
- `Descrição` → descrição

Na importação, componentes com o mesmo `codigo` são atualizados. Códigos que ainda não existem são inseridos. Linhas vazias são ignoradas e, se um código se repetir na planilha, a última ocorrência prevalece.

## Deploy no Render

O projeto usa Docker porque o Render não possui runtime PHP nativo.

1. No Render, crie um novo **Blueprint** usando este repositório, ou altere o runtime do serviço para **Docker**.
2. O Render utilizará automaticamente o `Dockerfile` e o `render.yaml`.

O SQLite funciona no Render, mas no plano gratuito os dados enviados por planilha podem ser perdidos após um novo deploy ou reinicialização. Para persistência permanente, utilize um Persistent Disk ou banco externo.

## Schema do Neon

Execute `database/neon-schema.sql` no SQL Editor do Neon para criar a tabela PostgreSQL de componentes, índices de pesquisa e atualização automática da data de alteração.

Depois, copie a **Connection string** do Neon e adicione no Render:

1. Abra o serviço no Render.
2. Acesse **Environment**.
3. Crie a variável `DATABASE_URL`.
4. Cole a connection string completa do Neon como valor.
5. Salve e aguarde o novo deploy.

Quando `DATABASE_URL` estiver configurada, consultas e importações usam o Neon. Sem essa variável, o aplicativo continua usando o SQLite local.

## Usuários

O acesso ao aplicativo exige login. Os usuários ficam na tabela `public.usuarios`, e as senhas são armazenadas somente como hashes bcrypt.

O arquivo local `database/usuarios-seed.sql` contém a carga inicial gerada a partir da planilha de usuários e não é enviado ao GitHub. Execute esse arquivo no SQL Editor do Neon após executar `database/neon-schema.sql`.
