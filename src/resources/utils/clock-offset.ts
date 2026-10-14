import { execFile } from 'node:child_process';
import os from 'node:os';

/**
 * Sonda de desvio do relógio do sistema (local − referência), em ms.
 *
 * O `ingress` medido em `interactions.route.ts` carrega o desync entre o
 * relógio local e o do Discord, porque `int.createdTimestamp` vem do snowflake
 * (relógio do Discord). Se o host estiver fora de sincronia, essa métrica fica
 * sem sentido. Aqui medimos o desvio para poder subtraí-lo.
 *
 * A sonda NUNCA altera o relógio do sistema. Ela só lê.
 */

export type ClockSource = 'w32tm' | 'chrony' | 'timedatectl' | 'adjtimex';

export interface ClockOffsetResult {
    /** ms, positivo = relógio local ADIANTADO em relação à referência. */
    offsetMs: number;
    source: ClockSource;
    sampledAt: number;
}

/** Acima disso a leitura não é desvio de relógio, e sim sujeira. */
const MAX_PLAUSIBLE_OFFSET_MS = 60_000;
const PROBE_TIMEOUT_MS = 30_000;

export type CommandRunner = (command: string, args: string[]) => Promise<string>;

const defaultRunner: CommandRunner = (command, args) =>
    new Promise((resolve, reject) => {
        execFile(command, args, { timeout: PROBE_TIMEOUT_MS, windowsHide: true }, (err, stdout) => {
            if (err) return reject(err);
            resolve(stdout);
        });
    });

const isWindows = os.platform() === 'win32';

const parseNumber = (value: string): number => {
    const normalized = value.replace(',', '.');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : NaN;
};

/* ───────────────────────────  Windows  ─────────────────────────── */

/**
 * `w32tm /stripchart` imprime uma linha por amostra:
 *   `20:50:21, +00.3343904s`
 * O sinal é o do NTP: `+` = referência ADIANTADA em relação a nós, logo o
 * relógio local está atrasado e `offsetMs` é negativo.
 */
export const parseW32tmStripchart = (output: string): number | null => {
    const matches = output.matchAll(/([+-])(\d+(?:[.,]\d+)?)s/gi);
    const samples: number[] = [];

    for (const match of matches) {
        const magnitude = parseNumber(match[2]);
        if (!Number.isFinite(magnitude)) continue;
        const sign = match[1] === '-' ? -1 : 1;
        samples.push(-sign * magnitude * 1000);
    }

    if (samples.length === 0) return null;
    return median(samples);
};

/* ───────────────────────────  Linux  ─────────────────────────── */

/**
 * `chronyc tracking`:
 *   System time : 0.000316560 seconds slow of NTP time
 *   Last offset : -0.000402412 seconds
 * `slow` = local atrasada → offset negativo; `fast` → positivo.
 */
export const parseChronyTracking = (output: string): number | null => {
    const lastOffset = output.match(/^Last offset\s*:\s*([+-]?\d+(?:[.,]\d+)?)/im);
    if (lastOffset) {
        const seconds = parseNumber(lastOffset[1]);
        if (Number.isFinite(seconds)) return seconds * 1000;
    }

    const systemTime = output.match(/^System time\s*:\s*([+-]?\d+(?:[.,]\d+)?)\s+seconds\s+(slow|fast)/im);
    if (systemTime) {
        const seconds = parseNumber(systemTime[1]);
        if (!Number.isFinite(seconds)) return null;
        const magnitude = Math.abs(seconds) * 1000;
        return systemTime[2].toLowerCase() === 'fast' ? magnitude : -magnitude;
    }

    return null;
};

/**
 * `timedatectl timesync-status` (systemd 254+) imprime `Offset: +334ms`.
 * Mesma convenção de sinal do `w32tm`: `+` = referência adiantada.
 */
export const parseTimedatectlTimesync = (output: string): number | null => {
    const match = output.match(/^Offset\s*:\s*([+-]?\d+(?:[.,]\d+)?)\s*(ms|s|µs|us)?/im);
    if (!match) return null;

    const value = parseNumber(match[1]);
    if (!Number.isFinite(value)) return null;

    switch ((match[2] || 'ms').toLowerCase()) {
        case 's':
            return -value * 1000;
        case 'µs':
        case 'us':
            return -value / 1000;
        default:
            return -value;
    }
};

/**
 * `adjtimex --print` expõe o kernel via `adjtimex(2)`:
 *   TIME_ERROR : 250000      (µs)
 *   ESTERROR   : 50000       (µs, erro estimado)
 */
export const parseAdjtimex = (output: string): number | null => {
    const error = output.match(/TIME_ERROR\s*:\s*(-?\d+)/i);
    if (!error) return null;

    const microseconds = Number(error[1]);
    if (!Number.isFinite(microseconds)) return null;

    const estimated = output.match(/ESTERROR\s*:\s*(\d+)/i);
    const toleranceMs = estimated ? Number(estimated[1]) / 1000 : 0;

    // ESTERROR é o limite inferior de confiança: acima dele não corrigimos.
    if (toleranceMs > Math.abs(microseconds / 1000)) return null;

    return microseconds / 1000;
};

/* ───────────────────────────  Commons  ─────────────────────────── */

const median = (values: number[]): number => {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};

const tryProbe = async (
    command: string,
    args: string[],
    parse: (output: string) => number | null,
    source: ClockSource,
    runner: CommandRunner
): Promise<ClockOffsetResult | null> => {
    try {
        const output = await runner(command, args);
        const offsetMs = parse(output);
        if (offsetMs === null || !Number.isFinite(offsetMs)) return null;
        if (Math.abs(offsetMs) > MAX_PLAUSIBLE_OFFSET_MS) return null;
        return { offsetMs, source, sampledAt: Date.now() };
    } catch {
        return null;
    }
};

/**
 * Mede o desvio do relógio local em relação a uma fonte UTC.
 *
 * Ordem de tentativa:
 *  - Windows: `w32tm /stripchart`, já configurado no sistema.
 *  - Linux: chrony → `timedatectl timesync-status` → `adjtimex --print`, porque
 *    cada um só funciona com o respectivo daemon ativo.
 */
export const measureClockOffset = async (runner: CommandRunner = defaultRunner): Promise<ClockOffsetResult | null> => {
    if (isWindows) {
        // /dataonly remove os cabeçalhos traduzidos que quebrariam o parser.
        return tryProbe('w32tm', ['/stripchart', '/computer:a.ntp.br', '/dataonly', '/samples:4'], parseW32tmStripchart, 'w32tm', runner);
    }

    const attempts: Array<{
        command: string;
        args: string[];
        parse: (output: string) => number | null;
        source: ClockSource;
    }> = [
        { command: 'chronyc', args: ['tracking'], parse: parseChronyTracking, source: 'chrony' },
        { command: 'timedatectl', args: ['timesync-status'], parse: parseTimedatectlTimesync, source: 'timedatectl' },
        { command: 'adjtimex', args: ['--print'], parse: parseAdjtimex, source: 'adjtimex' }
    ];

    for (const attempt of attempts) {
        const result = await tryProbe(attempt.command, attempt.args, attempt.parse, attempt.source, runner);
        if (result) return result;
    }

    return null;
};
