import logger from '../../configs/logger';

/**
 * Métricas de latência em memória (sem persistência).
 *
 * - `ingress`: tempo entre o Discord criar a interação e a requisição chegar no
 *   seu processo. O `int.createdTimestamp` vem do snowflake do ID, ou seja, do
 *   relógio do Discord, então o valor carrega também o desync entre os dois
 *   relógios:
 *
 *       Date.now() - createdTimestamp = latência real + (relógio local - relógio do Discord)
 *
 *   Guardamos o delta **com sinal** justamente para não esconder o desync: um
 *   valor negativo ou quase zero significa relógio local atrasado, e aí a
 *   métrica não é interpretável. Nesse caso `ingress` devolve `null` e o status
 *   sinaliza a dessincronia em vez de mostrar um número falso.
 * - `processing`: tempo gasto dentro do seu handler, medido com
 *   `performance.now()` (monotônico, imune a degrau de NTP).
 *
 * Guardamos uma janela curta e retornamos a mediana para que um pico isolado
 * não mova o número exibido no status.
 */
class Metrics {
    private static readonly WINDOW = 30;
    /** Menos amostras que isso, ainda não há confiança para mostrar o número. */
    private static readonly MIN_SAMPLES = 5;
    /** Latência de entrada mínima plausível para uma interação HTTP real. */
    private static readonly MIN_PLAUSIBLE_INGRESS = 10;
    private static readonly WARN_INTERVAL_MS = 10 * 60 * 1000;
    /** Depois disso, o offset medido é considerado velho e não é mais aplicado. */
    private static readonly CLOCK_OFFSET_TTL_MS = 30 * 60 * 1000;

    private ingressSamples: number[] = [];
    private processingSamples: number[] = [];
    private lastSkewWarnAt = 0;
    private clockOffsetValue: number | null = null;
    private clockOffsetAt = 0;
    private clockOffsetSource: string | null = null;

    private push(bucket: number[], value: number, allowNegative = false): void {
        if (!Number.isFinite(value)) return;
        if (!allowNegative && value < 0) return;
        bucket.push(value);
        if (bucket.length > Metrics.WINDOW) bucket.shift();
    }

    private median(bucket: number[]): number {
        if (bucket.length === 0) return 0;
        const sorted = [...bucket].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
    }

    /** Registra uma interação processada. `ingressMs` pode ser negativo (desync). */
    recordInteraction(ingressMs: number, processingMs: number): void {
        this.push(this.ingressSamples, ingressMs, true);
        this.push(this.processingSamples, processingMs);
    }

    /**
     * Latência de entrada (ms) ou `null` quando ela não é confiável —
     * poucas amostras ou relógio local dessincronizado em relação ao Discord
     * mesmo depois de aplicar o offset medido.
     */
    get ingress(): number | null {
        if (this.ingressSamples.length < Metrics.MIN_SAMPLES) return null;

        const rawMedian = this.median(this.ingressSamples);
        // Só desconta o offset se ele for recente; um valor velho pode
        // piorar a métrica em vez de melhorá-la.
        const offset = this.hasFreshClockOffset ? (this.clockOffsetValue as number) : 0;
        const corrected = rawMedian - offset;

        if (corrected < Metrics.MIN_PLAUSIBLE_INGRESS) {
            this.warnClockSkew(corrected);
            return null;
        }

        return corrected;
    }

    /** Registra o desvio medido do relógio (local − referência, em ms). */
    setClockOffset(offsetMs: number, source: string): void {
        if (!Number.isFinite(offsetMs)) return;
        this.clockOffsetValue = offsetMs;
        this.clockOffsetAt = Date.now();
        this.clockOffsetSource = source;
    }

    /** Desvio aplicado na correção, ou null se nunca foi medido ou já venceu. */
    get clockOffsetMs(): number | null {
        return this.hasFreshClockOffset ? this.clockOffsetValue : null;
    }

    /** true quando existe offset medido e ainda recente (< 30 min). */
    get hasFreshClockOffset(): boolean {
        return this.clockOffsetValue !== null && Date.now() - this.clockOffsetAt < Metrics.CLOCK_OFFSET_TTL_MS;
    }

    /** Mediana recente do tempo de processamento dentro do handler (ms). */
    get processing(): number {
        return this.median(this.processingSamples);
    }

    reset(): void {
        this.ingressSamples = [];
        this.processingSamples = [];
        this.lastSkewWarnAt = 0;
        this.clockOffsetValue = null;
        this.clockOffsetAt = 0;
        this.clockOffsetSource = null;
    }

    private warnClockSkew(median: number): void {
        const now = Date.now();
        if (this.lastSkewWarnAt !== 0 && now - this.lastSkewWarnAt < Metrics.WARN_INTERVAL_MS) return;
        this.lastSkewWarnAt = now;

        const direction = median < 0 ? 'atrasado' : 'adiantado';
        try {
            logger.logText(
                'WARN',
                `Relógio local ${direction} em relação ao Discord (mediana crua: ${Math.round(median)} ms). ` +
                    'A métrica de latência de entrada foi desativada — sincronize o relógio com NTP/chrony.'
            );
        } catch {
            // nunca deixar o log derrubar o status
        }
    }
}

const metrics = new Metrics();

export default metrics;
