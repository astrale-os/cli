/** @type {import('@astrale-os/kernel-cli').AstraleConfig} */
export default {
  preset: 'falkordb',
  graphName: '{{GRAPH_NAME}}',
  schema: './schema/main.gsl',
  outputDir: './schema',
  entry: './src/distribution.ts',
}
