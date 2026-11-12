import { lstatSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { assertLocalPath } from './paths.ts';
import { findBinary } from './runtime-config.ts';


export interface PlistSettings {
  appDirectory: string;
  dataDirectory: string;
  envFile: string;
  node?: string;
  opencode?: string | null;
  origin?: string;
  home?: string;
  path?: string;
}
export interface PlanSettings extends PlistSettings { outputDirectory: string; tailscale?: string }
export interface PreparationOptions {
  output?: string;
  appDirectory?: string;
  'data-dir'?: string;
  'env-file'?: string;
  origin?: string;
  opencode?: string;
}
export interface PreparationBundle { version: 1; outputDirectory: string; files: Record<string, string> }

export const LABEL = 'local.personal-ai.workspace';
const xml = (value: string) => value.replace(/[<>&"']/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[char] ?? char));
export const shellQuote = (value: string) => `'${String(value).replace(/'/g, `'"'"'`)}'`;

function absolute(value: string, name: string): string {
  if (!isAbsolute(value) || /[\x00-\x1f\x7f]/.test(value)) throw new Error(`${name} must be an absolute path without control characters.`);
  return assertLocalPath(value, name);
}

export function validateOrigin(value: string): string {
  if (!value) return '';
  let url;
  try { url = new URL(value); } catch { throw new Error('Origin must be an exact HTTPS Tailscale origin.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.port
      || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.ts\.net$/i.test(url.hostname) || value !== url.origin) {
    throw new Error('Origin must be an exact HTTPS Tailscale origin, without a path or port.');
  }
  return url.origin;
}

export function renderPlist({ appDirectory, dataDirectory, envFile, node = process.execPath, opencode, origin = '', home = homedir(), path = process.env.PATH }: PlistSettings) {
  appDirectory = absolute(appDirectory, 'Application directory');
  dataDirectory = absolute(dataDirectory, 'Data directory');
  envFile = absolute(envFile, 'Environment file');
  node = absolute(node, 'Node executable');
  if (opencode) opencode = absolute(opencode, 'OpenCode executable');
  origin = validateOrigin(origin);
  const environment = {
    HOME: home,
    PATH: path || `${dirname(node)}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`,
    WORKSPACE_DATA_DIR: dataDirectory,
    PORT: '4310',
    ...(opencode ? { OPENCODE_BIN: opencode } : {}),
    ...(origin ? { WORKSPACE_PUBLIC_ORIGIN: origin } : {}),
  };
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array>
    <string>${xml(node)}</string>
    <string>${xml(`--env-file-if-exists=${envFile}`)}</string>
    <string>${xml(join(appDirectory, 'src/main.js'))}</string>
  </array>
  <key>WorkingDirectory</key><string>${xml(appDirectory)}</string>
  <key>EnvironmentVariables</key><dict>
${Object.entries(environment).map(([key, value]) => `    <key>${key}</key><string>${xml(value)}</string>`).join('\n')}
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>15</integer>
  <key>ExitTimeOut</key><integer>30</integer>
  <key>Umask</key><integer>63</integer>
  <key>StandardOutPath</key><string>${xml(join(dataDirectory, 'server.stdout.log'))}</string>
  <key>StandardErrorPath</key><string>${xml(join(dataDirectory, 'server.stderr.log'))}</string>
</dict></plist>
`;
}

export function renderPlan({ outputDirectory, appDirectory, dataDirectory, envFile, node = process.execPath, origin = '', tailscale = '/Applications/Tailscale.app/Contents/MacOS/Tailscale', home = homedir(), opencode }: PlanSettings) {
  const q = shellQuote, source = join(outputDirectory, `${LABEL}.plist`), target = join(home, 'Library/LaunchAgents', `${LABEL}.plist`);
  const foregroundEnv = ['PORT=4310', `WORKSPACE_DATA_DIR=${dataDirectory}`, ...(origin ? [`WORKSPACE_PUBLIC_ORIGIN=${origin}`] : []), ...(opencode ? [`OPENCODE_BIN=${opencode}`] : [])].map(q).join(' ');
  return `Personal AI Mac mini operation plan — generated only; no settings applied

Application: ${appDirectory}
State/worktrees/logs: ${dataDirectory}
Private environment file: ${envFile}
Login: ${join(dataDirectory, 'access-code.txt')} (or WORKSPACE_PASSWORD in private environment file)
HTTPS origin: ${origin || 'NOT SET — sign in to Tailscale, read Self.DNSName from status, then regenerate with --origin https://<exact-device-name>.ts.net'}
OpenCode executable: ${opencode || 'NOT FOUND — existing installation or an approved installation is required before startup'}

Preparation (no system settings; keep env file outside Git, mode 600):
- Review the generated plist and server.env.example. If the env file already exists, preserve it and edit only intended settings.
- Retain existing OpenCode config/auth locations. If you use XDG_CONFIG_HOME, XDG_DATA_HOME, OPENCODE_CONFIG, OPENCODE_CONFIG_DIR, or provider environment variables, put those settings in the private env file. Never copy credential values into this plan or plist.
- The plist fixes PORT=4310 and the data directory${origin ? ', and fixes the supplied HTTPS origin' : ''}; these plist values take precedence over the env file. Regenerate it when changing those values.
- Stop any foreground workspace server using this data directory before loading the LaunchAgent. Existing server.pid locking prevents duplicate instances.
- Verify the Node/OpenCode paths still exist after upgrading those programs.

Local foreground check:
cd ${q(appDirectory)}
/usr/bin/env ${foregroundEnv} ${q(node)} ${q(`--env-file-if-exists=${envFile}`)} src/main.js

SYSTEM CHANGES — execute only after user approval:
1. If Tailscale is installed but disconnected, open its app and sign in. Join MacBook/mobile to the same tailnet. Review grants/ACLs to allow only the intended user/devices to this Mac mini TCP 443. Enable MagicDNS and HTTPS certificates if Tailscale prompts. No Funnel/public access.
2. With an exact origin configured and app running on 127.0.0.1:4310, review existing Serve configuration before changing it:
${q(tailscale)} serve status --json
${origin ? `${q(tailscale)} serve --bg --https=443 http://127.0.0.1:4310` : '# Remote activation command withheld until --origin is supplied and reviewed.'}
${q(tailscale)} serve status
   Do not replace an existing HTTPS 443 service without reviewing it. Verify Funnel is disabled.
3. User-login automatic startup (LaunchAgent; does not run before macOS login):
mkdir -p ${q(dataDirectory)} ${q(dirname(target))}
chmod 700 ${q(dataDirectory)}
# Preserve an existing LaunchAgent before replacing it; do not load while another server is running.
install -m 600 ${q(source)} ${q(target)}
launchctl bootstrap "gui/$(id -u)" ${q(target)}
launchctl print "gui/$(id -u)/${LABEL}"

Verification:
- Open ${origin || 'the configured HTTPS origin'} on MacBook and mobile while connected to Tailscale; log in separately using the same app password.
- Confirm both clients show the same task ID/history, follow-up queue, approval, and changes.
- Close a client and confirm work continues; reconnect and verify history.
- Sign out and verify protected API access is rejected. Remote cookies require HTTPS.
- Test user logout/reboot/sleep behavior separately. LaunchAgent starts after login; it does not prevent Mac sleep, unlock FileVault, or recover a running model process without interruption.

Rollback (system changes; preserve data):
launchctl bootout "gui/$(id -u)" ${q(target)}
${q(tailscale)} serve --https=443 off
# Remove only this app's LaunchAgent file if you no longer want startup. Do not use serve reset: other services may exist.
# Serve rollback above is appropriate only if port 443 was allocated solely to this app; otherwise restore the reviewed prior configuration.

References:
https://tailscale.com/docs/reference/tailscale-cli/serve
https://tailscale.com/docs/features/tailscale-serve
`;
}

export function planPreparation(options: PreparationOptions): PreparationBundle {
  if (!options.output) throw new Error('Choose a local output directory with --output /absolute/path.');
  if (!options.appDirectory) throw new Error('Choose the workspace application with --app-dir /absolute/path.');
  const appDirectory = absolute(options.appDirectory, 'Application directory');
  const dataDirectory = absolute(options['data-dir'] || process.env.WORKSPACE_DATA_DIR || join(homedir(), '.local/share/personal-ai'), 'Data directory');
  const outputDirectory = absolute(options.output, 'Output directory');
  const envFile = absolute(options['env-file'] || join(dataDirectory, 'server.env'), 'Environment file');
  const origin = validateOrigin(options.origin || process.env.WORKSPACE_PUBLIC_ORIGIN || '');
  const opencode = options.opencode || findBinary('opencode', process.env, homedir(), appDirectory);
  const settings = { appDirectory, dataDirectory, outputDirectory, envFile, origin, opencode, tailscale: findBinary('tailscale') || undefined };
  const files = {
    [`${LABEL}.plist`]: renderPlist(settings),
    'remote-plan.txt': renderPlan(settings),
    'server.env.example': '# Private runtime environment; edit outside the Git repository, mode 600.\n# Existing files must be preserved. No credentials are generated here.\n# Runtime paths/port/origin are set by the plist and the foreground command in remote-plan.txt.\n# XDG_CONFIG_HOME=/absolute/path/to/existing/config\n# XDG_DATA_HOME=/absolute/path/to/existing/data\n# OPENCODE_CONFIG=/absolute/path/to/existing/opencode.json\n# WORKSPACE_PASSWORD=at-least-16-characters-or-use-generated-access-code\n',
  };
  let present = true;
  try { lstatSync(outputDirectory); }
  catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') present = false; else throw error; }
  if (present) throw new Error('Preparation directory already exists. Choose a fresh output directory.');
  return { version: 1, outputDirectory, files };
}

function writePreparation(bundle: PreparationBundle): string {
  // Create a fresh destination atomically; never chmod or merge into an existing directory.
  mkdirSync(dirname(bundle.outputDirectory), { recursive: true, mode: 0o700 });
  mkdirSync(bundle.outputDirectory, { mode: 0o700 });
  for (const [name, contents] of Object.entries(bundle.files)) writeFileSync(join(bundle.outputDirectory, name), contents, { flag: 'wx', mode: 0o600 });
  return bundle.outputDirectory;
}

export function prepare(options: PreparationOptions): string {
  return writePreparation(planPreparation(options));
}
