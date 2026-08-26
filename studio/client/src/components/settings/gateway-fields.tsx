import { SettingsHint } from './hint'

export function GatewayHeading({ status, help = false }: { status: string; help?: boolean }) {
  return (
    <div className="mb-1.5 flex items-center gap-1.5 px-1">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Model gateway
      </span>
      {help && (
        <SettingsHint text="Route the local Claude Code harness through a custom Anthropic-compatible endpoint (e.g. an Astrale ai-gateway model node) instead of its built-in auth. The URL + token are set as ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN on the spawned `claude` child ONLY — never your shell or a `claude` you run outside the studio." />
      )}
      <span className="ml-auto text-[10px] text-muted-foreground">{status}</span>
    </div>
  )
}

export function GatewayTextField({
  label,
  hint,
  value,
  onChange,
  placeholder,
}: {
  label: string
  hint: string
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  return (
    <div className="space-y-1">
      <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
        {label}
        <SettingsHint text={hint} />
      </span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        className="w-full rounded-md border bg-card px-2 py-1 font-mono text-[12px] outline-none placeholder:text-muted-foreground focus:border-primary"
      />
    </div>
  )
}
