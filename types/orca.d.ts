// Tipi minimi dell'API di Orca usata da questo plugin. Servono solo al typecheck locale:
// Orca 1.4.248 non fornisce `orca.d.ts` (`orca plugin types` fallisce). Sostituire con i tipi ufficiali quando disponibili.
declare module 'orca' {
  /** Mappa dei messaggi pannello -> worker; la riempie `src/protocol.ts`. */
  export interface PluginRequests {}
}

declare module 'orca/worker' {
  import type { PluginRequests } from 'orca'
  type Input<K extends keyof PluginRequests> = PluginRequests[K] extends { input: infer I } ? I : undefined
  type Output<K extends keyof PluginRequests> = PluginRequests[K] extends { output: infer O } ? O : never
  export interface OrcaWorkerApi {
    panels: { handle<K extends keyof PluginRequests>(name: K, fn: (input: Input<K>) => Promise<Output<K>>): void }
    host: { call(name: string, input: unknown): Promise<unknown> }
    settings: { get(key: string): Promise<unknown> }
  }
}
