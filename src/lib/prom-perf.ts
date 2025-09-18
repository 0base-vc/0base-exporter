// Use runtime require to avoid type resolution issues
// eslint-disable-next-line @typescript-eslint/no-var-requires
declare const require: any;
const promClient: any = require('prom-client');
type Gauge = any;
type Registry = any;

// Global map to track start times between reset and first set per gauge instance
const gaugeStartTimes = new WeakMap<Gauge, number>();

// Keep original methods
const originalReset = promClient.Gauge?.prototype?.reset as (() => void) | undefined;
const originalLabels = promClient.Gauge?.prototype?.labels as ((...labels: string[]) => any) | undefined;
const originalSet = promClient.Gauge?.prototype?.set as ((value: number) => void) | undefined;

// Patch only once
let patched = false;
export function patchPromClientGaugeTiming(): void {
    if (patched) return;
    patched = true;

    // Patch Registry.registerMetric to attach back-reference to the registry
    const origRegisterMetric = promClient.Registry?.prototype?.registerMetric as ((metric: any) => void) | undefined;
    if (origRegisterMetric) {
        promClient.Registry.prototype.registerMetric = function patchedRegisterMetric(this: any, metric: any) {
            try { (metric as any).__registry = this; } catch {}
            return origRegisterMetric.call(this, metric);
        } as any;
    }

    // Patch reset: mark start time
    promClient.Gauge.prototype.reset = function patchedReset(this: Gauge) {
        gaugeStartTimes.set(this, Date.now());
        if (typeof originalReset === 'function') {
            return originalReset.call(this);
        }
    } as any;

    // Wrap labels().set() chain to record on first set after reset
    promClient.Gauge.prototype.labels = function patchedLabels(this: Gauge, ...labelValues: string[]) {
        const labeled = originalLabels ? originalLabels.apply(this, labelValues) : this;
        if (!originalSet) return labeled;

        const selfGauge = this as Gauge;
        const setFn = labeled.set;
        labeled.set = function patchedSet(this: any, ...args: any[]) {
            const start = gaugeStartTimes.get(selfGauge);
            if (typeof start === 'number') {
                const duration = Date.now() - start;
                // Emit timing metric if registry metric exists
                tryEmitPerfMetric(selfGauge, duration, selfGauge['name']);
                gaugeStartTimes.delete(selfGauge);
            }
            return setFn.apply(this, args);
        };
        return labeled;
    } as any;

    // Also patch direct gauge.set(value) without labels
    if (originalSet) {
        promClient.Gauge.prototype.set = function patchedDirectSet(this: Gauge, ...args: any[]) {
            const start = gaugeStartTimes.get(this);
            if (typeof start === 'number') {
                const duration = Date.now() - start;
                tryEmitPerfMetric(this, duration, (this as any)['name']);
                gaugeStartTimes.delete(this);
            }
            return (originalSet as any).apply(this, args);
        } as any;
    }
}

// A registry-local performance gauge cache
const registryPerfGauge = new WeakMap<Registry, Gauge>();

function getOrCreatePerfGauge(registry: Registry): Gauge {
    let g = registryPerfGauge.get(registry);
    if (!g) {
        g = new promClient.Gauge({
            name: `metric_set_duration_ms`,
            help: 'Time from reset to next set() in milliseconds',
            labelNames: ['metric']
        });
        registry.registerMetric(g);
        registryPerfGauge.set(registry, g);
    }
    return g;
}

// Try to emit the timing using the gauge's private registry reference if available
function tryEmitPerfMetric(sourceGauge: Gauge, durationMs: number, metricName: string) {
    try {
        const registry: Registry | undefined =
            (sourceGauge as any).__registry ||
            ((sourceGauge as any).registers && (sourceGauge as any).registers[0]) ||
            (sourceGauge as any).registry ||
            (sourceGauge as any).register;
        if (!registry) return;
        const perf = getOrCreatePerfGauge(registry);
        perf.labels(metricName).set(durationMs);
    } catch {
        // ignore
    }
}

// Auto-patch on import
patchPromClientGaugeTiming();

// Also export helper to ensure perf gauge exists in a given registry (optional)
export function ensurePerfGauge(registry: Registry): void {
    getOrCreatePerfGauge(registry);
}


