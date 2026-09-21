# Matrícula e relatório de Novos Negócios

Clique no nome de um negócio, tanto no funil quanto na lista, para abrir sua ficha e gerar o relatório PDF. O relatório usa uma nova leitura dos dados ao gerar, para incluir alterações recentes.

No cadastro ou edição, envie o PDF da matrícula (até 20 MB) e confira o número. O sistema tenta ler a primeira página; em documentos digitalizados, tenta o nome do arquivo. Sem identificação, o número pode ser digitado. O envio do PDF exige um número preenchido. Não há OCR automático nem interpretação jurídica do documento.

O relatório contém visão geral, VGV potencial, projeto e responsável, fase, datas, descrição, localização, desenho esquemático do KMZ, imagens e histórico. Reproduz todas as páginas da matrícula e incorpora os arquivos originais da matrícula e do KMZ no painel de anexos do PDF. Alguns leitores de navegador não mostram anexos; use um leitor compatível para extraí-los. Os bytes originais da matrícula são preservados no anexo; as páginas reproduzidas não substituem o original assinado.

Imagens adicionais vêm de Arquivos do negócio. Imagens incompatíveis ou acima de 20 MB são relacionadas nas pendências do relatório; vídeos e outros documentos aparecem no inventário. Falhas ao baixar matrícula ou KMZ interrompem a geração, evitando um relatório silenciosamente incompleto. Não são gravados links temporários de documentos privados no PDF.

## Imagem do Google

O campo Imagem da área aceita PNG, JPG ou WebP (até 20 MB), preservando a proporção e os créditos da imagem. Esse caminho funciona sem configuração adicional.

Opcionalmente, configure `GOOGLE_MAPS_STATIC_API_KEY` no servidor, com Maps Static API habilitada. Quando não há imagem enviada, a rota autenticada `/api/businesses/[id]/area-map` obtém a imagem de satélite com o traçado simplificado do KMZ, usando as permissões do usuário. A chave nunca é enviada ao navegador. Sem chave ou em caso de erro do Google, o relatório registra a ausência da imagem e mantém o desenho do KMZ e o link do Google Maps. A integração não armazena imagens do Google no servidor.

Referências: [Maps Static API](https://developers.google.com/maps/documentation/maps-static/start), [Storage com RLS](https://supabase.com/docs/guides/storage/security/access-control).

## Instalação e validação

Aplicar `20260921140358_business_registry_report.sql` antes de publicar o código. A migração adiciona campos opcionais e o bucket privado `business-documents`, mantendo as colunas e permissões existentes da visão operacional. O bucket limita tipo/tamanho e permite limpar envios do próprio usuário antes da criação do negócio. A gravação do registro e das referências aos arquivos ocorre em uma única operação; falhas removem os novos arquivos e preservam os anteriores.

Testes automatizados cobrem reconhecimento do número, validação de PDFs, geometria, montagem/anexos do relatório, políticas de acesso e restrições dos campos. O fluxo no navegador foi validado com serviços locais de teste, inclusive o PDF digitalizado fornecido, criação/edição, imagem enviada, download e falha de salvamento. Nenhum PDF fornecido foi atribuído a um negócio real durante esses testes.
