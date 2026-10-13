# NERV UI — fontes embarcadas

Fontes usadas no render da imagem de status do bot (`src/resources/utils/status-image.ts`),
empacotadas no repositório e embutidas via `@font-face` + base64 no SVG para que o resultado
seja idêntico em qualquer servidor (sem depender de fonte instalada no sistema).

| Arquivo | Família | Peso | Origem |
| --- | --- | --- | --- |
| `Oswald-Regular.ttf` | `NervDisplay` | 400 | [google/fonts](https://github.com/google/fonts/tree/main/ofl/oswald) |
| `Oswald-SemiBold.ttf` | `NervDisplay` | 600 | idem |
| `Oswald-Bold.ttf` | `NervDisplay` | 700 | idem |
| `FiraCode-Regular.ttf` | `NervMono` | 400 | [google/fonts](https://github.com/google/fonts/tree/main/ofl/firacode) |
| `FiraCode-Bold.ttf` | `NervMono` | 700 | idem |

Referências de design: `https://github.com/mdrbx/nerv-ui` (biblioteca NERV-UI, usada apenas como
referência de estilo — nenhum código dela é copiado para cá).

## Licença

Ambas as famílias são **SIL Open Font License 1.1**: `OFL-Oswald.txt` e `OFL-FiraCode.txt`.
Os `.ttf` foram gerados a partir das fontes variáveis do Google Fonts com `fonttools`
(`fontTools.varLib.instancer`), fixando o peso desejado.

## Como é carregado

`src/resources/fonts/index.ts` procura os arquivos em `dist/resources/fonts` e, como fallback,
em `src/resources/fonts` (quando se roda direto do TypeScript). O `npm run build` copia a pasta
para `dist/` via `scripts/copy-assets.js`. Se os arquivos não existirem, o SVG é renderizado com
a stack de fontes do sistema (Arial Narrow / Impact + Consolas / DejaVu Sans Mono).
