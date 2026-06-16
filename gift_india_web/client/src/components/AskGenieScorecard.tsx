import { useMemo, useState } from 'react';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  GenieChatInput,
  GenieChatMessageList,
  useGenieChat,
} from '@databricks/appkit-ui/react';
import { ChevronDown, ChevronRight, Sparkles } from 'lucide-react';

type FacilityContext = {
  name: string;
  district: string;
  state: string;
  facilityId: string;
};

function starterPrompts(ctx: FacilityContext | null): string[] {
  if (!ctx) {
    return [
      'Which districts have the most facilities with contradicting ICU evidence?',
      'List JCI-accredited hospitals with strong emergency capability evidence.',
      'How many facilities in Uttar Pradesh claim ICU but have weak or suspicious evidence?',
    ];
  }
  return [
    `Which capabilities at ${ctx.name} have contradicting evidence?`,
    `How does ${ctx.name}'s mean trust score compare to other hospitals in ${ctx.district}?`,
    `List JCI-accredited facilities in ${ctx.state} with strong ICU evidence.`,
  ];
}

function AskGeniePanel({ facility }: { facility: FacilityContext | null }) {
  const { messages, status, sendMessage, error } = useGenieChat({
    alias: 'default',
    persistInUrl: false,
  });
  const prompts = useMemo(() => starterPrompts(facility), [facility]);
  const busy = status === 'streaming' || status === 'loading-history';

  return (
    <div className="flex h-[min(28rem,60vh)] flex-col overflow-hidden rounded-lg border bg-card">
      <div className="shrink-0 space-y-2 border-b bg-muted/20 px-3 py-2.5">
        <p className="text-xs text-muted-foreground">
          Natural-language queries over governed <code className="text-[11px]">gold.*</code> tables — Genie
          does not change trust scores or clear review flags.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {prompts.map((q) => (
            <Button
              key={q}
              type="button"
              variant="outline"
              size="sm"
              className="h-auto max-w-full whitespace-normal px-2.5 py-1 text-left text-[11px] font-normal leading-snug"
              disabled={busy}
              onClick={() => sendMessage(q)}
            >
              {q}
            </Button>
          ))}
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <GenieChatMessageList messages={messages} status={status} className="flex-1" />
        {error ? (
          <p className="shrink-0 border-t bg-destructive/5 px-3 py-2 text-xs text-destructive">{error}</p>
        ) : null}
        <div className="shrink-0 border-t p-2">
          <GenieChatInput
            onSend={sendMessage}
            disabled={busy}
            placeholder={
              facility
                ? `Ask about ${facility.name} or regional facility trust data…`
                : 'Ask about facility trust signals, evidence, or accreditation…'
            }
          />
        </div>
      </div>
    </div>
  );
}

export function AskGenieScorecard({ facility }: { facility: FacilityContext | null }) {
  const [open, setOpen] = useState(false);

  return (
    <Card className="gift-lift" data-demo="ask-genie">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CardHeader className="space-y-0 p-0">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-muted/40"
            >
              {open ? (
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Sparkles className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-foreground">Ask Genie</span>
                <span className="block text-xs text-muted-foreground">
                  Query governed facility data in plain language
                  {facility ? ` · context: ${facility.name}` : ''}
                </span>
              </span>
            </button>
          </CollapsibleTrigger>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="space-y-2 px-4 pb-4 pt-0">
            <AskGeniePanel facility={facility} />
            <p className="text-[11px] text-muted-foreground">
              Requires the Genie plugin and <code>DATABRICKS_GENIE_SPACE_ID</code> on the server. Answers cite SQL
              over Unity Catalog / Lakehouse — not live website crawls.
            </p>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
