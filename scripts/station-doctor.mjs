#!/usr/bin/env node
import { parseStationDoctorArgs, runStationDoctor } from "../chama/stationDoctor.js";

const usage = `Uso: node scripts/station-doctor.mjs [opções]

Opções:
  --env-file <path>
  --require-systemd
  --timeout-ms <n>
  --help`;

let options;
try {
  options = parseStationDoctorArgs(process.argv.slice(2));
} catch (error) {
  console.error(`erro: ${error.message}`);
  console.error(usage);
  process.exitCode = 2;
}

if (options?.help) {
  console.log(usage);
} else if (options) {
  try {
    const result = await runStationDoctor(options);
    for (const line of result.lines) console.log(line);
    process.exitCode = result.exitCode;
  } catch (error) {
    console.error(`erro: ${error.message || "falha inesperada"}`);
    console.error("Station Doctor: FALHOU");
    process.exitCode = 1;
  }
}
