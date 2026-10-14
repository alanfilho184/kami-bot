import sharp from 'sharp';
import { DateTime } from 'luxon';
import { getFontFacesCss, FONT_DISPLAY, FONT_MONO } from '../fonts';

export interface StatusInteractionsRow {
    label: string;
    commands: number;
    components: number;
    total: number;
    highlight?: boolean;
}

export interface StatusWeeklyPoint {
    label: string;
    total: number;
    /** Total do mesmo dia da semana anterior. */
    previous?: number;
    isToday: boolean;
}

export interface StatusBanner {
    text: string;
    detail?: string;
    color: string;
    accent?: string;
}

export interface StatusImageData {
    cpu: number;
    memory: number;
    ramUsedGb: number;
    ramTotalGb: number;
    restPing?: number;
    dbPing?: number;
    /** Latência de entrada (ms) ou null quando não há dado confiável. */
    ingressLatency?: number | null;
    /** Desvio aplicado na correção (ms), ou null se não medido/velho. */
    clockOffsetMs?: number | null;
    /** Ciclo do status: encode da imagem + upload da mensagem. */
    cycleMs?: number;
    encodeMs?: number;
    uploadMs?: number;
    uptime: string;
    guildCount?: number;
    userCount?: number;
    activeUsers?: number;
    sheetsCreated?: number;
    interactions: StatusInteractionsRow[];
    dailyGrowth: string;
    weeklyGrowth: string;
    monthlyGrowth: string;
    weeklyUsage: StatusWeeklyPoint[];
    version: string;
    nodeVersion: string;
    accent: string;
    banner?: StatusBanner | null;
}

/* ──────────────────────────────  TOKENS  ────────────────────────────── */

const WIDTH = 900;
const PAD = 20;

/**
 * Densidade de rasterização (dpi). 144 = 2x a largura base, gerando
 * 1800x2300 px. O custo de render é proporcional ao quadrado da escala, então
 * baixar derruba a CPU — 144 -> 96 corta metade do tempo — em troca da nitidez
 * do texto. Ajuste com STATUS_IMAGE_DENSITY sem precisar recompilar.
 */
const DENSITY = (() => {
    const configured = Number(process.env.STATUS_IMAGE_DENSITY);
    return Number.isFinite(configured) && configured >= 72 ? configured : 144;
})();

/**
 * Formato de saída: WebP lossless. Medido no layout atual, entrega os mesmos
 * pixels do PNG com ~46% menos payload (529 KB -> 286 KB), o que reduz o
 * buffer em memória e o tempo de upload a cada ciclo de 1 minuto.
 * O Discord aceita webp em anexos/embeds.
 */
export const STATUS_IMAGE_EXTENSION = 'webp';
export const STATUS_IMAGE_MIME = 'image/webp';
const WEBP_EFFORT = 6;

const NERV = {
    void: '#000000',
    panel: '#0A0A0A',
    panelAlt: '#05070A',
    line: '#1C2029',
    lineSoft: '#121620',
    text: '#E6E8EE',
    muted: '#9AA1B2',
    dim: '#7A8291',
    green: '#00FF00',
    orange: '#FF9900',
    red: '#FF2B1D',
    amber: '#FFAA00'
} as const;

/* ──────────────────────────────  HELPERS  ────────────────────────────── */

const esc = (value: string): string => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const num = (value: number | undefined | null): string => Number(value ?? 0).toLocaleString('pt-BR');

const compact = (value: number): string => {
    const n = Number(value) || 0;
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.', ',')} mi`;
    if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1).replace('.', ',')} mil`;
    return String(n);
};

const niceMax = (value: number): number => {
    if (value <= 0) return 10;
    const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
    for (const step of [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
        const candidate = step * magnitude;
        if (candidate >= value) return candidate;
    }
    return 10 * magnitude;
};

interface TextOptions {
    size?: number;
    weight?: number;
    fill?: string;
    anchor?: 'start' | 'middle' | 'end';
    tracking?: number;
    mono?: boolean;
    opacity?: number;
}

const text = (x: number, y: number, content: string, options: TextOptions = {}): string => {
    const { size = 13, weight = 400, fill = NERV.text, anchor = 'start', tracking, mono, opacity } = options;
    const family = mono ? FONT_MONO : FONT_DISPLAY;
    const attrs = [
        `x="${x}"`,
        `y="${y}"`,
        `font-family="${family}"`,
        `font-size="${size}"`,
        `font-weight="${weight}"`,
        `fill="${fill}"`,
        `text-anchor="${anchor}"`
    ];
    if (tracking) attrs.push(`letter-spacing="${tracking}"`);
    if (opacity !== undefined) attrs.push(`opacity="${opacity}"`);
    return `<text ${attrs.join(' ')}>${esc(content)}</text>`;
};

const rect = (
    x: number,
    y: number,
    w: number,
    h: number,
    fill: string,
    options: { stroke?: string; strokeWidth?: number; fillRef?: string; opacity?: number } = {}
): string => {
    const { stroke, strokeWidth = 1, fillRef, opacity } = options;
    const attrs = [
        `x="${x}"`,
        `y="${y}"`,
        `width="${Math.max(0, w)}"`,
        `height="${Math.max(0, h)}"`,
        `fill="${fillRef ?? fill}"`
    ];
    if (stroke) attrs.push(`stroke="${stroke}"`, `stroke-width="${strokeWidth}"`);
    if (opacity !== undefined) attrs.push(`opacity="${opacity}"`);
    return `<rect ${attrs.join(' ')} />`;
};

const line = (x: number, y: number, w: number, h: number, color: string, opacity?: number): string =>
    `<line x1="${x}" y1="${y}" x2="${x + w}" y2="${y + h}" stroke="${color}" stroke-width="1"${
        opacity !== undefined ? ` opacity="${opacity}"` : ''
    } />`;

const growthColor = (value: string): string => {
    if (value.startsWith('↑')) return NERV.green;
    if (value.startsWith('↓')) return NERV.red;
    return NERV.muted;
};

/**
 * Largura estimada de um texto, em px de layout.
 *
 * Os fatores são propositalmente pessimistas (0.78 do tamanho da fonte para
 * display e 0.63 para mono) e representam uma fonte condensada. Assim o layout
 * continua correto mesmo se os TTF não forem encontrados no deploy e o render
 * cair numa fonte do sistema mais larga.
 */
const measure = (content: string, size: number, tracking = 0, mono = false): number =>
    Array.from(content).length * (size * (mono ? 0.68 : 0.82) + tracking);

/**
 * Reduz o texto até caber em maxWidth: primeiro diminui o corpo da fonte
 * (até minSize) e só depois corta com reticências.
 */
const fitText = (
    content: string,
    maxWidth: number,
    size: number,
    tracking = 0,
    mono = false,
    minSize = 10
): { text: string; size: number } => {
    let currentSize = size;

    while (currentSize > minSize && measure(content, currentSize, tracking, mono) > maxWidth) {
        currentSize -= 0.5;
    }

    if (measure(content, currentSize, tracking, mono) <= maxWidth) {
        return { text: content, size: currentSize };
    }

    let chars = Array.from(content);
    while (chars.length > 1 && measure(`${chars.join('')}…`, currentSize, tracking, mono) > maxWidth) {
        chars = chars.slice(0, -1);
    }

    return { text: `${chars.join('')}…`, size: currentSize };
};

/* ──────────────────────────  NERV PRIMITIVES  ────────────────────────── */

/** Moldura técnica com hairline; sem cantos arredondados. */
const frame = (x: number, y: number, w: number, h: number, color: string, fill = 'none'): string =>
    rect(x, y, w, h, fill, { stroke: color });

/** Label "grudada" no canto superior-esquerdo da moldura, como nos painéis NERV. */
const frameTag = (x: number, y: number, title: string, color: string): string =>
    rect(x, y - 7, measure(title, 11, 2) + 16, 14, NERV.void, { stroke: color }) +
    rect(x, y - 7, 3, 14, color) +
    text(x + 13, y + 3.5, title, { size: 11, weight: 600, tracking: 2, fill: color });

/** Cabeçalho de seção: bloco + rótulo display + fio ocupando o resto da linha. */
const sectionHeader = (x: number, y: number, width: number, title: string, color: string, note?: string): string => {
    const titleWidth = measure(title, 14, 3.2);
    const labelWidth = 19 + titleWidth;
    const noteWidth = note ? measure(note, 11, 0, true) : 0;
    const ruleStart = x + labelWidth + 8;
    const ruleEnd = x + width - (note ? noteWidth + 12 : 0);

    let svg =
        rect(x, y - 11, 11, 11, color) + text(x + 19, y, title, { size: 14, weight: 700, tracking: 3.2, fill: color });
    if (ruleEnd > ruleStart) {
        svg += line(ruleStart, y - 5.5, ruleEnd - ruleStart, 0, color, 0.35);
    }
    if (note) {
        const fitted = fitText(note, Math.max(0, width - labelWidth - 20), 11, 0, true);
        svg += text(x + width, y, fitted.text, { size: fitted.size, fill: NERV.muted, anchor: 'end', mono: true });
    }
    return svg;
};

/**
 * Rail segmentado no espírito do GradientStatusBar/SyncProgressBar:
 * blocos discretos, cursor branco no valor e zonas de qualidade ao fundo.
 */
const segmentedRail = (
    x: number,
    y: number,
    w: number,
    h: number,
    ratio: number,
    color: string,
    segments = 20,
    options?: RailOptions
): string => {
    const clamped = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
    const max = options?.max && options.max > 0 ? options.max : 100;
    let svg = rect(x, y, w, h, '#0E1218');

    for (const zone of options?.zones ?? []) {
        const zx = x + w * Math.max(0, Math.min(1, zone.start / max));
        const zw = w * Math.max(0, Math.min(1, (zone.end - zone.start) / max));
        svg += rect(zx, y, zw, h, zone.color, { opacity: 0.14 });
        if (zone.start > 0) svg += line(zx, y - 3, 0, h + 6, zone.color, 0.6);
    }

    // Só os blocos acesos são desenhados, para as zonas continuam visíveis
    const gap = 2;
    const blockW = (w - gap * (segments - 1)) / segments;
    const filledBlocks = Math.round(clamped * segments);
    for (let i = 0; i < filledBlocks; i++) {
        const bx = x + i * (blockW + gap);
        svg += rect(bx, y, blockW, h, color);
    }

    if (clamped > 0) {
        const cursorX = x + Math.min(w - 1, w * clamped);
        svg += line(cursorX, y - 3, 0, h + 6, '#FFFFFF', 0.9);
    }
    return svg;
};

/** Placa com um canto cortado (usada só em elementos de identidade). */
const cutPlate = (x: number, y: number, w: number, h: number, cut: number, color: string): string =>
    `<path d="M ${x + cut} ${y} L ${x + w} ${y} L ${x + w} ${y + h} L ${x} ${y + h} L ${x} ${
        y + cut
    } Z" fill="none" stroke="${color}" stroke-width="1" />`;

const statusDot = (x: number, y: number, color: string): string =>
    rect(x, y - 5, 7, 7, color) + rect(x - 2, y - 7, 11, 11, 'none', { stroke: color, opacity: 0.45 });

/* ────────────────────────────────  DEFS  ─────────────────────────────── */

const hexPoints = (r: number): string =>
    Array.from({ length: 6 }, (_, i) => {
        const angle = (Math.PI / 3) * i - Math.PI / 6;
        return `${(r * Math.cos(angle)).toFixed(2)},${(r * Math.sin(angle)).toFixed(2)}`;
    }).join(' ');

const HEX_RADIUS = 15;
const HEX_TILE_W = HEX_RADIUS * 1.5;
const HEX_TILE_H = HEX_RADIUS * Math.sqrt(3);
const HEX_OPACITY = 0.1;

/** Desenho de um tile do hex. O segundo polígono cobre o corte na borda. */
const hexTileContent = (accent: string): string => `
            <polygon points="${hexPoints(HEX_RADIUS)}" fill="none" stroke="${accent}" stroke-width="0.7"
                transform="translate(${HEX_RADIUS}, ${HEX_TILE_H / 2})" />
            <polygon points="${hexPoints(HEX_RADIUS)}" fill="none" stroke="${accent}" stroke-width="0.7"
                transform="translate(${HEX_RADIUS + HEX_TILE_W / 2}, ${HEX_TILE_H / 2 + HEX_TILE_H / 2})" />`;

/**
 * Tile do hex pré-renderizado, para ladrilhar como fundo.
 *
 * Desenhar a grade com um preenchimento de padrão dentro do SVG faz o librsvg
 * percorrer o padrão em toda a tela a cada render — medido em ~2,7x do tempo
 * total, bem acima das fontes (94% do SVG, custo zero) e do WebP. Ladrilhar um
 * PNG já rasterizado com o `tile` do libvips é um blit SIMD, e o resultado é
 * visualmente o mesmo (delta máximo de 26/255, só o traço a 10% de opacidade).
 *
 * Em cache por cor de acento, que é a única coisa que muda o desenho.
 */
const hexTileCache = new Map<string, Buffer>();

const getHexTile = async (accent: string): Promise<Buffer | null> => {
    const cached = hexTileCache.get(accent);
    if (cached) return cached;

    try {
        const tile = await sharp(
            Buffer.from(
                `<svg xmlns="http://www.w3.org/2000/svg" width="${HEX_TILE_W}" height="${HEX_TILE_H}"` +
                    ` viewBox="0 0 ${HEX_TILE_W} ${HEX_TILE_H}">` +
                    `<g opacity="${HEX_OPACITY}">${hexTileContent(accent)}</g></svg>`
            ),
            { density: DENSITY }
        )
            .png()
            .toBuffer();

        hexTileCache.set(accent, tile);
        return tile;
    } catch {
        // Sem hex o status ainda sai; melhor que falhar a imagem inteira.
        return null;
    }
};

const buildDefs = (accent: string, hazardColor: string): string => `<defs>
        <pattern id="hazard" width="22" height="22" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect x="0" y="0" width="22" height="22" fill="${NERV.void}" />
            <rect x="0" y="0" width="11" height="22" fill="${hazardColor}" />
        </pattern>
        <pattern id="hatch" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect x="0" y="0" width="3" height="9" fill="${accent}" opacity="0.14" />
        </pattern>
    </defs>`;

/* ──────────────────────────────  COMPONENTES  ────────────────────────── */

const SYSTEM_CARD_HEIGHT = 122;
const COMMUNITY_CARD_HEIGHT = 96;
const GRID_HEADER = 26;
const GRID_ROW = 28;
const GRID_FOOTER = 22;
const CHART_HEIGHT = 262;
const BANNER_HEIGHT = 88;
const PLATE_HEIGHT = 54;
const HEADER_HEIGHT = 84;
const FOOTER_HEIGHT = 34;

interface RailZone {
    start: number;
    end: number;
    color: string;
}

/**
 * Escalas e limiares de severidade das métricas de latência.
 *
 * `LATÊNCIA DE SAÍDA` mede uma ida e volta (`GET /applications/@me`), enquanto
 * `LATÊNCIA DE ENTRADA` mede só a ida (snowflake -> chegada no processo). As
 * duas compartilham o mesmo caminho de rede, então a componente de rede da
 * segunda é aproximadamente metade: por isso as escalas não podem ser iguais.
 *
 * Os limiares de cor seguem a mesma severidade relativa nos dois cards, de modo
 * que grandezas comparáveis nunca sejam julgadas de forma contraditória.
 */
interface LatencyScale {
    /** Teto da escala (ms). */
    max: number;
    /** Acima disso: âmbar. */
    warn: number;
    /** Acima disso: vermelho. */
    critical: number;
    ticks: { at: number; label: string; anchor?: 'start' | 'middle' | 'end' }[];
    zones: { start: number; end: number }[];
}

const API_LATENCY: LatencyScale = {
    max: 600,
    warn: 200,
    critical: 400,
    ticks: [
        { at: 200, label: '200' },
        { at: 400, label: '400' },
        { at: 600, label: '600 MS', anchor: 'end' }
    ],
    zones: [
        { start: 0, end: 200 },
        { start: 200, end: 400 },
        { start: 400, end: 600 }
    ]
};

const INGRESS: LatencyScale = {
    max: 300,
    warn: 100,
    critical: 200,
    ticks: [
        { at: 100, label: '100' },
        { at: 200, label: '200' },
        { at: 300, label: '300 MS', anchor: 'end' }
    ],
    zones: [
        { start: 0, end: 100 },
        { start: 100, end: 200 },
        { start: 200, end: 300 }
    ]
};

const severityColor = (value: number, scale: LatencyScale, accent: string): string => {
    if (value > scale.critical) return NERV.red;
    if (value > scale.warn) return NERV.orange;
    return accent;
};

/** Preenche a primeira zona com o accent do card e as demais com as cores de estado. */
const latencyRailOptions = (scale: LatencyScale, accent: string): RailOptions => ({
    max: scale.max,
    ticks: scale.ticks,
    zones: scale.zones.map((zone, index) => ({
        start: zone.start,
        end: zone.end,
        color: index === 0 ? accent : index === 1 ? NERV.orange : NERV.red
    }))
});

interface RailOptions {
    /** Teto da escala (ex.: 600 para milissegundos). Padrão: 100 (percentual). */
    max: number;
    /** Rótulo do extremo direito, usado quando `ticks` não é informado. */
    maxLabel?: string;
    /** Zonas de qualidade desenhadas atrás do rail. */
    zones?: RailZone[];
    /** Marcações da escala exibidas abaixo do rail. */
    ticks?: { at: number; label: string; anchor?: 'start' | 'middle' | 'end' }[];
}

const systemCard = (
    x: number,
    y: number,
    w: number,
    h: number,
    code: string,
    label: string,
    value: string,
    unit: string,
    detail: string | string[],
    railRatio: number,
    railColor: string,
    accent: string,
    railOptions?: RailOptions
): string => {
    let svg = frame(x, y, w, h, NERV.line, NERV.panelAlt);
    svg += frameTag(x, y, code, accent);
    svg += text(x + 14, y + 26, label, { size: 11, weight: 600, tracking: 2.4, fill: NERV.muted });

    // valor: encolhe até caber ao lado da unidade
    const valueMax = unit ? w - 28 - measure(unit, 13, 0, true) - 10 : w - 28;
    const fittedValue = fitText(value, valueMax, 32, 0, true, 16);
    svg += text(x + 14, y + 62, fittedValue.text, { size: fittedValue.size, weight: 700, mono: true, fill: NERV.text });
    if (unit) {
        svg += text(x + 18 + measure(fittedValue.text, fittedValue.size, 0, true), y + 62, unit, {
            size: 13,
            mono: true,
            fill: NERV.muted
        });
    }

    // detalhe: 1 ou 2 linhas, cada uma encolhida/cortada até caber no card
    const details = Array.isArray(detail) ? detail : [detail];
    details.slice(0, 2).forEach((line, index) => {
        const fitted = fitText(line, w - 28, 11, 0, true, 9);
        svg += text(x + 14, y + 82 + index * 15, fitted.text, {
            size: fitted.size,
            mono: true,
            fill: index === 0 ? NERV.dim : NERV.muted
        });
    });

    const railX = x + 14;
    const railW = w - 28;
    svg += segmentedRail(railX, y + h - 22, railW, 8, railRatio, railColor, 20, railOptions);

    const scaleMax = railOptions?.max ?? 100;
    const scaleTicks = railOptions?.ticks ?? [
        { at: scaleMax, label: railOptions?.maxLabel ?? '100%', anchor: 'end' as const }
    ];
    svg += text(railX, y + h - 4, '0', { size: 10, mono: true, fill: NERV.dim });
    for (const tick of scaleTicks) {
        const tx = railX + railW * Math.max(0, Math.min(1, tick.at / scaleMax));
        svg += text(tx, y + h - 4, tick.label, {
            size: 10,
            mono: true,
            fill: NERV.dim,
            anchor: tick.anchor ?? 'middle'
        });
    }
    return svg;
};

const communityCard = (
    x: number,
    y: number,
    w: number,
    h: number,
    index: string,
    label: string,
    value: string,
    accent: string,
    sub?: string
): string => {
    let svg = frame(x, y, w, h, NERV.line, NERV.panelAlt);
    svg += text(x + 14, y + 22, index, { size: 11, mono: true, fill: NERV.dim });
    svg += line(x + 38, y + 18, w - 52, 0, NERV.line, 0.9);
    svg += text(x + 14, y + 46, label, { size: 11, weight: 600, tracking: 2, fill: NERV.muted });
    svg += text(x + 14, y + 74, value, { size: 24, weight: 700, mono: true, fill: accent });
    if (sub) {
        svg += text(x + w - 14, y + 76, sub, { size: 11, mono: true, fill: NERV.dim, anchor: 'end' });
    }
    return svg;
};

const dataGrid = (rows: StatusInteractionsRow[], top: number, width: number, accent: string): string => {
    const xCommands = PAD + width - 300;
    const xComponents = PAD + width - 156;
    const xTotal = PAD + width - 14;

    let svg = frame(PAD, top, width, GRID_HEADER + GRID_ROW * rows.length + GRID_FOOTER, NERV.line);
    svg += rect(PAD + 1, top + 1, width - 2, GRID_HEADER - 1, accent);

    svg += text(PAD + 14, top + 18, 'PERÍODO', { size: 11, weight: 700, tracking: 2, fill: NERV.void });
    svg += text(xCommands, top + 18, 'COMANDOS', {
        size: 11,
        weight: 700,
        tracking: 2,
        fill: NERV.void,
        anchor: 'end'
    });
    svg += text(xComponents, top + 18, 'COMPONENTES', {
        size: 11,
        weight: 700,
        tracking: 2,
        fill: NERV.void,
        anchor: 'end'
    });
    svg += text(xTotal, top + 18, 'TOTAL', {
        size: 11,
        weight: 700,
        tracking: 2,
        fill: NERV.void,
        anchor: 'end'
    });

    rows.forEach((row, index) => {
        const rowTop = top + GRID_HEADER + GRID_ROW * index;
        if (row.highlight) {
            svg += rect(PAD + 1, rowTop, width - 2, GRID_ROW, '#FFFFFF', { opacity: 0.04 });
            svg += rect(PAD + 1, rowTop, 3, GRID_ROW, accent);
        }
        if (index > 0) svg += line(PAD + 1, rowTop, width - 2, 0, NERV.line, 0.85);

        const baseline = rowTop + 19;
        const labelFill = row.highlight ? accent : NERV.text;
        svg += text(PAD + 14, baseline, row.label.toUpperCase(), {
            size: 12,
            weight: row.highlight ? 700 : 400,
            tracking: 1.2,
            fill: labelFill
        });
        svg += text(xCommands, baseline, num(row.commands), {
            size: 13,
            mono: true,
            anchor: 'end',
            fill: row.highlight ? NERV.text : NERV.muted
        });
        svg += text(xComponents, baseline, num(row.components), {
            size: 13,
            mono: true,
            anchor: 'end',
            fill: row.highlight ? NERV.text : NERV.muted
        });
        svg += text(xTotal, baseline, num(row.total), {
            size: 13,
            weight: 700,
            mono: true,
            anchor: 'end',
            fill: row.highlight ? accent : NERV.text
        });
    });

    const footerTop = top + GRID_HEADER + GRID_ROW * rows.length;
    svg += line(PAD + 1, footerTop, width - 2, 0, NERV.line);
    svg += rect(PAD + 1, footerTop + 1, width - 2, GRID_FOOTER - 2, NERV.panel);
    svg += text(PAD + 14, footerTop + 16, `ROWS: ${String(rows.length).padStart(2, '0')}`, {
        size: 11,
        mono: true,
        fill: NERV.dim
    });
    svg += text(
        PAD + width - 14,
        footerTop + 16,
        `JANELA DE TEMPO // ${DateTime.now().setZone('America/Fortaleza').toFormat('dd/MM/yyyy')}`,
        { size: 11, mono: true, fill: NERV.dim, anchor: 'end' }
    );

    return svg;
};

/** Barra segmentada vertical (linguagem BarChart NERV): só blocos acesos. */
const segmentedBar = (
    cx: number,
    baseline: number,
    barWidth: number,
    plotHeight: number,
    ratio: number,
    color: string,
    opacity: number,
    blocks = 24,
    blockGap = 3
): { svg: string; barHeight: number } => {
    const lit = Math.max(ratio > 0 ? 1 : 0, Math.round(ratio * blocks));
    const blockH = (plotHeight - blockGap * (blocks - 1)) / blocks;
    const barHeight = lit * (blockH + blockGap) - blockGap;

    let svg = '';
    for (let b = 0; b < lit; b++) {
        const by = baseline - (b + 1) * blockH - b * blockGap;
        svg += rect(cx - barWidth / 2, by, barWidth, blockH, color, { opacity });
    }
    return { svg, barHeight };
};

const weeklyChart = (points: StatusWeeklyPoint[], top: number, width: number, accent: string): string => {
    const axisWidth = 64;
    const plotLeft = PAD + 14 + axisWidth;
    const plotRight = PAD + width - 14;
    const plotWidth = plotRight - plotLeft;

    const hasPrevious = points.some(point => (Number(point.previous) || 0) > 0);
    const plotTop = top + 38;
    const rowHeight = CHART_HEIGHT - 38 - 46;
    const baseline = plotTop + rowHeight;

    let svg = frame(PAD, top, width, CHART_HEIGHT, NERV.line, NERV.panelAlt);
    svg += rect(PAD + 1, top + 1, width - 2, CHART_HEIGHT - 2, NERV.void, { opacity: 0.35 });

    const currentTotals = points.map(point => Number(point.total) || 0);
    const previousTotals = points.map(point => Number(point.previous) || 0);
    const max = niceMax(Math.max(...currentTotals, ...(hasPrevious ? previousTotals : []), 0));

    for (let step = 0; step <= 4; step++) {
        const ratio = step / 4;
        svg += line(plotLeft, baseline - rowHeight * ratio, plotWidth, 0, accent, 0.18);
        svg += text(plotLeft - 12, baseline - rowHeight * ratio + 4, compact(max * ratio), {
            size: 11,
            mono: true,
            fill: NERV.dim,
            anchor: 'end'
        });
    }

    // Legenda
    const legendY = top + 22;
    const legendItem = (lx: number, label: string, color: string, filled: boolean): string =>
        rect(lx, legendY - 7, 10, 10, filled ? color : 'none', {
            stroke: color,
            opacity: filled ? 0.95 : 0.8
        }) + text(lx + 16, legendY + 2, label, { size: 10, weight: 600, tracking: 1.6, fill: NERV.muted });
    let legendX = plotRight - measure('SEMANA ATUAL', 10, 1.6) - 24;
    if (hasPrevious) {
        svg += legendItem(legendX, 'SEMANA PASSADA', accent, false);
        legendX -= measure('SEMANA ATUAL', 10, 1.6) + 34;
        svg += legendItem(legendX, 'SEMANA ATUAL', accent, true);
    } else {
        svg += legendItem(legendX, 'SEMANA ATUAL', accent, true);
    }

    // Barras lado a lado por dia: semana passada à esquerda, atual à direita
    const slot = plotWidth / points.length;
    const innerGap = 8;
    const barWidth = hasPrevious ? Math.min(38, (slot - innerGap - 26) / 2) : Math.min(46, slot * 0.5);

    points.forEach((point, index) => {
        const center = plotLeft + slot * index + slot / 2;
        const currentCx = hasPrevious ? center + (barWidth + innerGap) / 2 : center;
        const previousCx = center - (barWidth + innerGap) / 2;
        const currentRatio = max > 0 ? Math.max(0, Math.min(1, (Number(point.total) || 0) / max)) : 0;
        const previousRatio = max > 0 ? Math.max(0, Math.min(1, (Number(point.previous) || 0) / max)) : 0;

        if (hasPrevious) {
            const previous = segmentedBar(previousCx, baseline, barWidth, rowHeight, previousRatio, accent, 0.4);
            svg += previous.svg;
            svg += text(previousCx, baseline - previous.barHeight - 9, compact(point.previous ?? 0), {
                size: 10,
                mono: true,
                fill: NERV.dim,
                anchor: 'middle'
            });
        }

        const current = segmentedBar(
            currentCx,
            baseline,
            barWidth,
            rowHeight,
            currentRatio,
            accent,
            point.isToday ? 1 : 0.78
        );
        svg += current.svg;

        svg += text(currentCx, baseline - current.barHeight - 11, compact(point.total), {
            size: 12,
            weight: point.isToday ? 700 : 400,
            mono: true,
            fill: point.isToday ? accent : NERV.muted,
            anchor: 'middle'
        });

        svg += text(center, baseline + 22, point.label.toUpperCase(), {
            size: 12,
            weight: point.isToday ? 700 : 400,
            tracking: 1.4,
            fill: point.isToday ? accent : NERV.muted,
            anchor: 'middle'
        });

        if (point.isToday) {
            svg += rect(center - 12, baseline + 30, 24, 3, accent);
        }
    });

    svg += line(plotLeft, baseline, plotWidth, 0, accent, 0.5);

    return svg;
};

const growthPlate = (x: number, y: number, w: number, h: number, label: string, value: string): string =>
    frame(x, y, w, h, NERV.line, NERV.panel) +
    rect(x + 1, y + 1, w - 2, h - 2, NERV.void, { fillRef: 'url(#hatch)' }) +
    rect(x, y, 3, h, growthColor(value)) +
    text(x + 16, y + 22, label, { size: 11, weight: 600, tracking: 2.4, fill: NERV.muted }) +
    text(x + 16, y + 43, value, { size: 16, weight: 700, mono: true, fill: growthColor(value) }) +
    rect(x + w - 16, y + 16, 6, 6, growthColor(value), { opacity: 0.85 });

const emergencyBanner = (banner: StatusBanner, top: number, width: number): string => {
    const stripeH = 10;
    const bodyH = BANNER_HEIGHT - stripeH * 2;
    const color = banner.accent ?? banner.color;
    const centerX = PAD + width / 2;

    let svg = rect(PAD, top, width, stripeH, NERV.void, { fillRef: 'url(#hazard)' });
    svg += rect(PAD, top + stripeH, width, bodyH, color);
    svg += rect(PAD, top + stripeH, width, 2, NERV.void);
    svg += rect(PAD, top + stripeH + bodyH - 2, width, 2, NERV.void);
    svg += text(centerX, top + stripeH + 30, banner.text, {
        size: 25,
        weight: 700,
        tracking: 5,
        fill: NERV.void,
        anchor: 'middle'
    });
    if (banner.detail) {
        svg += text(centerX, top + stripeH + 48, banner.detail.toUpperCase(), {
            size: 11,
            mono: true,
            fill: NERV.void,
            anchor: 'middle',
            opacity: 0.78
        });
    }
    svg += rect(PAD, top + BANNER_HEIGHT - stripeH, width, stripeH, NERV.void, { fillRef: 'url(#hazard)' });
    return svg;
};

/* ──────────────────────────────  RENDER  ─────────────────────────────── */

export async function renderStatusImage(data: StatusImageData): Promise<Buffer> {
    const accent = data.accent || '#0082FF';
    const bannerColor = data.banner?.color ?? NERV.red;
    const bannerAccent = data.banner?.accent ?? NERV.red;

    const bannerOffset = data.banner ? BANNER_HEIGHT + 18 : 0;

    const systemTop = HEADER_HEIGHT + 34 + bannerOffset;
    const systemRow = systemTop + SYSTEM_CARD_HEIGHT;
    const communityTop = systemRow + 46;
    const communityRow = communityTop + COMMUNITY_CARD_HEIGHT;
    const gridTop = communityRow + 46;
    const gridHeight = GRID_HEADER + GRID_ROW * data.interactions.length + GRID_FOOTER;
    const chartTop = gridTop + gridHeight + 46;
    const chartRow = chartTop + CHART_HEIGHT;
    const plateTop = chartRow + 34;
    const plateRow = plateTop + PLATE_HEIGHT;
    const footerTop = plateRow + 30;
    const height = footerTop + FOOTER_HEIGHT + 18;

    const contentWidth = WIDTH - PAD * 2;
    const gap = 12;

    let svg = buildDefs(accent, bannerAccent);
    // O fundo e o hex saem do SVG de propósito: ver `getHexTile`.
    svg += rect(0, 0, WIDTH, 3, accent);

    /* ── Header ───────────────────────────────────────────────────────── */
    const headerCenter = 42;
    const nowFt = DateTime.now().setZone('America/Fortaleza');
    const subtitle = 'STATUS DE OPERAÇÃO // MONITORAMENTO EM TEMPO REAL';
    const instanceLabel = data.banner ? 'BACKUP (FAILOVER)' : 'SERVIDOR PRIMÁRIO';

    // Limites do header: título à esquerda, placa de instância ao centro-direita
    // e bloco de data/hora encostado na borda direita.
    const clockLine2 = `${nowFt.toFormat('HH:mm:ss')} GMT-3`;
    const clockWidth = Math.max(
        measure(`ATUALIZADO ${nowFt.toFormat('dd/MM/yyyy')}`, 12, 0, true),
        measure(clockLine2, 11, 0, true)
    );
    const plateRight = WIDTH - PAD - clockWidth - 22;
    const platePadding = 60;
    const plateMinX = 400;
    const plateLabel = fitText(instanceLabel, plateRight - plateMinX - platePadding, 12, 2);
    const plateW = Math.min(plateRight - plateMinX, measure(plateLabel.text, plateLabel.size, 2) + platePadding);
    const plateX = plateRight - plateW;
    const plateH = 34;
    const plateY = headerCenter - plateH / 2;

    svg += rect(PAD, headerCenter - 17, 3, 34, accent);
    svg += text(PAD + 13, headerCenter + 2, fitText('KAMI BOT', plateX - PAD - 30, 27, 5.5).text, {
        size: 27,
        weight: 700,
        tracking: 5.5,
        fill: NERV.text
    });
    const fittedSubtitle = fitText(subtitle, plateX - PAD - 26, 11, 0, true);
    svg += text(PAD + 13, headerCenter + 20, fittedSubtitle.text, {
        size: fittedSubtitle.size,
        mono: true,
        fill: NERV.muted
    });

    svg += cutPlate(plateX, plateY, plateW, plateH, 10, data.banner ? bannerAccent : NERV.line);
    svg += statusDot(plateX + 16, headerCenter + 1, data.banner ? NERV.red : NERV.green);
    svg += text(plateX + 32, headerCenter + 5, plateLabel.text, {
        size: plateLabel.size,
        weight: 600,
        tracking: 2,
        fill: data.banner ? NERV.text : NERV.muted
    });

    svg += text(WIDTH - PAD, headerCenter - 4, `ATUALIZADO ${nowFt.toFormat('dd/MM/yyyy')}`, {
        size: 12,
        mono: true,
        fill: NERV.text,
        anchor: 'end'
    });
    svg += text(WIDTH - PAD, headerCenter + 14, clockLine2, {
        size: 11,
        mono: true,
        fill: NERV.dim,
        anchor: 'end'
    });
    svg += line(0, HEADER_HEIGHT, WIDTH, 0, accent, 0.35);

    /* ── Banner de emergência ─────────────────────────────────────────── */
    if (data.banner) {
        svg += emergencyBanner(data.banner, HEADER_HEIGHT + 16, contentWidth);
    }

    /* ── Sistema ──────────────────────────────────────────────────────── */
    svg += sectionHeader(PAD, systemTop - 12, contentWidth, 'SISTEMA', accent, 'RECURSOS E LATÊNCIA');
    const systemCardWidth = (contentWidth - gap * 3) / 4;
    svg += systemCard(
        PAD,
        systemTop,
        systemCardWidth,
        SYSTEM_CARD_HEIGHT,
        'SYS-01',
        'CPU',
        `${data.cpu}%`,
        '',
        'carga de processamento',
        data.cpu / 100,
        data.cpu > 85 ? NERV.red : accent,
        accent
    );
    svg += systemCard(
        PAD + systemCardWidth + gap,
        systemTop,
        systemCardWidth,
        SYSTEM_CARD_HEIGHT,
        'SYS-02',
        'MEMÓRIA',
        String(data.memory),
        'MB',
        `${data.ramUsedGb.toFixed(1)} GB DE ${data.ramTotalGb.toFixed(1)} GB`,
        data.ramTotalGb > 0 ? data.ramUsedGb / data.ramTotalGb : 0,
        accent,
        accent
    );
    // Os cards têm 206 unidades de largura e `measure()` é pessimista de propósito
    // (protege o fallback DejaVu, mais largo que as fontes bundladas). Com esses
    // dois fatores o `fitText` corta o detalhe a partir de ~24 caracteres, então
    // as strings abaixo ficam nesse limite para não encolher a fonte.
    const restPing = Number(data.restPing ?? 0);
    svg += systemCard(
        PAD + (systemCardWidth + gap) * 2,
        systemTop,
        systemCardWidth,
        SYSTEM_CARD_HEIGHT,
        'SYS-03',
        'LATÊNCIA DE SAÍDA',
        String(Math.round(restPing)),
        'ms',
        `roundtrip // DB ${data.dbPing ?? 0} ms`,
        Math.min(1, restPing / API_LATENCY.max),
        severityColor(restPing, API_LATENCY, accent),
        accent,
        latencyRailOptions(API_LATENCY, accent)
    );
    const clockOffset = data.clockOffsetMs ?? null;
    // "ajustado" (e não "ajuste") deixa claro que o desvio JÁ foi descontado do
    // número acima do card — não é uma instrução para o usuário corrigir. O
    // escopo é o valor exibido, não o relógio: a sonda nunca mexe no SO.
    const offsetText =
        clockOffset === null
            ? 'relogio n/d'
            : `valor ajustado ${clockOffset < 0 ? '' : '+'}${Math.round(clockOffset)} ms`;

    const ingressRaw = data.ingressLatency ?? null;
    const ingress = ingressRaw === null ? 0 : ingressRaw;
    const ingressSkewed = ingressRaw === null;
    svg += systemCard(
        PAD + (systemCardWidth + gap) * 3,
        systemTop,
        systemCardWidth,
        SYSTEM_CARD_HEIGHT,
        'SYS-04',
        'LATÊNCIA DE ENTRADA',
        ingressSkewed ? 'INDISPONÍVEL' : String(Math.round(ingress)),
        ingressSkewed ? '' : 'ms',
        ingressSkewed ? 'relogio ≠ discord' : offsetText,
        ingressSkewed ? 0 : Math.min(1, ingress / INGRESS.max),
        ingressSkewed ? NERV.orange : severityColor(ingress, INGRESS, accent),
        accent,
        latencyRailOptions(INGRESS, accent)
    );

    /* ── Comunidade ───────────────────────────────────────────────────── */
    svg += sectionHeader(PAD, communityTop - 12, contentWidth, 'COMUNIDADE', accent, 'BASE DE USUÁRIOS');
    const communityCardWidth = (contentWidth - gap * 3) / 4;
    svg += communityCard(
        PAD,
        communityTop,
        communityCardWidth,
        COMMUNITY_CARD_HEIGHT,
        '01',
        'SERVIDORES',
        num(data.guildCount),
        accent
    );
    svg += communityCard(
        PAD + (communityCardWidth + gap),
        communityTop,
        communityCardWidth,
        COMMUNITY_CARD_HEIGHT,
        '02',
        'USUÁRIOS',
        num(data.userCount),
        accent
    );
    svg += communityCard(
        PAD + (communityCardWidth + gap) * 2,
        communityTop,
        communityCardWidth,
        COMMUNITY_CARD_HEIGHT,
        '03',
        'USUÁRIOS ATIVOS',
        num(data.activeUsers),
        accent,
        '30d'
    );
    svg += communityCard(
        PAD + (communityCardWidth + gap) * 3,
        communityTop,
        communityCardWidth,
        COMMUNITY_CARD_HEIGHT,
        '04',
        'FICHAS CRIADAS',
        num(data.sheetsCreated),
        accent
    );

    /* ── Interações ───────────────────────────────────────────────────── */
    svg += sectionHeader(PAD, gridTop - 12, contentWidth, 'INTERAÇÕES', accent, 'COMANDOS E COMPONENTES');
    svg += dataGrid(data.interactions, gridTop, contentWidth, accent);

    /* ── Uso na semana ────────────────────────────────────────────────── */
    const weeklyTotal = data.weeklyUsage.reduce((sum, point) => sum + (Number(point.total) || 0), 0);
    const weeklyPreviousTotal = data.weeklyUsage.reduce((sum, point) => sum + (Number(point.previous) || 0), 0);
    const weeklyNote =
        weeklyPreviousTotal > 0
            ? `${num(weeklyTotal)} INTERAÇÕES // ANT ${num(weeklyPreviousTotal)}`
            : `${num(weeklyTotal)} INTERAÇÕES`;
    svg += sectionHeader(PAD, chartTop - 12, contentWidth, 'USO NA SEMANA', accent, weeklyNote);
    svg += weeklyChart(data.weeklyUsage, chartTop, contentWidth, accent);

    /* ── Variações ────────────────────────────────────────────────────── */
    const plateWidth = (contentWidth - gap * 2) / 3;
    svg += growthPlate(PAD, plateTop, plateWidth, PLATE_HEIGHT, 'VARIAÇÃO DIÁRIA', data.dailyGrowth);
    svg += growthPlate(
        PAD + plateWidth + gap,
        plateTop,
        plateWidth,
        PLATE_HEIGHT,
        'VARIAÇÃO SEMANAL',
        data.weeklyGrowth
    );
    svg += growthPlate(
        PAD + (plateWidth + gap) * 2,
        plateTop,
        plateWidth,
        PLATE_HEIGHT,
        'VARIAÇÃO MENSAL',
        data.monthlyGrowth
    );

    /* ── Rodapé ───────────────────────────────────────────────────────── */
    svg += line(PAD, footerTop, contentWidth, 0, NERV.line);
    const controlText = data.banner ? 'CONTROLE: SERVIDOR BACKUP' : 'CONTROLE: SERVIDOR PRIMÁRIO';
    const controlWidth = measure(controlText, 11, 0, true);
    const cycle = Number(data.cycleMs ?? 0);
    const cycleText = cycle > 0 ? `CICLO ${(cycle / 1000).toFixed(1).replace('.', ',')} S` : '';
    const footerParts = [
        `VER ${data.version}`,
        `NODE ${data.nodeVersion}`,
        cycleText,
        `UPTIME ${data.uptime.toUpperCase()}`
    ].filter(part => part !== '');
    const footerAvailable = contentWidth - controlWidth - 24;
    let cursorX = PAD;
    for (const part of footerParts) {
        const fitted = fitText(part, footerAvailable - (cursorX - PAD), 11, 0, true);
        if (!fitted.text) break;
        svg += text(cursorX, footerTop + 20, fitted.text, { size: fitted.size, mono: true, fill: NERV.dim });
        cursorX += measure(fitted.text, fitted.size, 0, true) + 22;
    }
    svg += text(WIDTH - PAD, footerTop + 20, controlText, {
        size: 11,
        mono: true,
        fill: data.banner ? NERV.red : NERV.dim,
        anchor: 'end'
    });

    const svgDocument = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}">
<style>
${getFontFacesCss()}
</style>
${svg}
</svg>`;

    const hexTile = await getHexTile(accent);

    const layers: sharp.OverlayOptions[] = [];
    if (hexTile) layers.push({ input: hexTile, tile: true, blend: 'over' });
    layers.push({ input: Buffer.from(svgDocument), density: DENSITY, blend: 'over' });

    return sharp({
        create: {
            width: Math.round((WIDTH * DENSITY) / 72),
            height: Math.round((height * DENSITY) / 72),
            channels: 4,
            background: NERV.void
        }
    })
        .composite(layers)
        .webp({ lossless: true, effort: WEBP_EFFORT })
        .toBuffer();
}
