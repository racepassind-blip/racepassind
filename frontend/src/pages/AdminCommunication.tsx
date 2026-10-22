import { useEffect, useState } from "react";
import { AlertCircle, Bot, CheckCircle2, RefreshCw, Save, Send, ShieldCheck, WifiOff } from "lucide-react";
import { Link } from "react-router-dom";

import { AdminDashboardLayout } from "@/components/AdminDashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { apiRequest } from "@/lib/api";
import { toast } from "@/components/ui/sonner";

interface CommunicationSettings {
  channel: string;
  enabled: boolean;
  sender_name: string;
  gmail_address: string;
  gmail_api_configured: boolean;
}

interface AiLoadTestResult {
  status: "idle" | "queued" | "running" | "cooldown" | "completed" | "failed";
  stage: number;
  stageTotal: number;
  completed: number;
  total: number;
  successes: number;
  failures: number;
  stages?: Array<{ stage: number; concurrency: number; requests: number; successes: number; failures: number; average: number | null; maximum: number | null; p95: number | null; tokensPerSecond: number | null }>;
  totalDuration?: number | null;
  recommendation?: string | null;
  error?: string | null;
}

const AdminCommunication = () => {
  const [settings, setSettings] = useState<CommunicationSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testRecipient, setTestRecipient] = useState("");
  const [testStatus, setTestStatus] = useState<"idle" | "success" | "error" | null>(null);
  const [testMessage, setTestMessage] = useState("");
  const [testingAi, setTestingAi] = useState(false);
  const [aiResult, setAiResult] = useState<{ success: boolean; response?: string; modelAvailable?: boolean; totalDuration?: number; modelLoadDuration?: number | null; detail?: string } | null>(null);
  const [aiLoadTest, setAiLoadTest] = useState<AiLoadTestResult | null>(null);
  const [startingLoadTest, setStartingLoadTest] = useState(false);

  const loadSettings = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiRequest<CommunicationSettings>("/admin/communication");
      setSettings(response);
      setTestRecipient(response.gmail_address || "");
    } catch (loadError) {
      console.error("Failed to load settings:", loadError);
      setError(loadError instanceof Error ? loadError.message : "Could not load communication settings.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSettings();
  }, []);

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      // Only send fields that have changed
      const payload: Partial<Pick<CommunicationSettings, "sender_name" | "gmail_address" | "enabled">> = {};
      if (settings.sender_name !== null && settings.sender_name !== undefined) {
        payload.sender_name = settings.sender_name;
      }
      if (settings.gmail_address !== null && settings.gmail_address !== undefined) {
        payload.gmail_address = settings.gmail_address;
      }
      payload.enabled = settings.enabled;

      const updated = await apiRequest<CommunicationSettings>("/admin/communication", {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      setSettings(updated);
      toast.success("Communication settings saved");
    } catch (saveError) {
      console.error("Failed to save settings:", saveError);
      toast.error(saveError instanceof Error ? saveError.message : "Could not save settings.");
    } finally {
      setSaving(false);
    }
  };

  const handleSendTest = async () => {
    if (!testRecipient) {
      toast.error("Please enter a recipient email address");
      return;
    }
    setSendingTest(true);
    setTestStatus(null);
    setTestMessage("");

    try {
      const response = await apiRequest<{ success: boolean; message: string }>("/admin/communication/test-email", {
        method: "POST",
        body: JSON.stringify({ recipient_email: testRecipient }),
        // Allow time for OAuth token refresh and the Gmail API request.
        timeoutMs: 20_000,
      });
      if (response.success) {
        setTestStatus("success");
        setTestMessage(response.message);
      } else {
        setTestStatus("error");
        setTestMessage(response.message);
      }
    } catch (testError) {
      setTestStatus("error");
      setTestMessage(testError instanceof Error ? testError.message : "Test email failed.");
    } finally {
      setSendingTest(false);
    }
  };

  const updateSetting = (key: keyof CommunicationSettings, value: CommunicationSettings[keyof CommunicationSettings]) => {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : null));
    setTestStatus(null);
    setTestMessage("");
  };

  const handleTestAi = async () => {
    setTestingAi(true);
    setAiResult(null);
    try {
      setAiResult(await apiRequest<typeof aiResult>("/admin/communication/test-ai", {
        method: "POST",
        timeoutMs: 210_000,
      }));
    } catch (aiError) {
      setAiResult({ success: false, detail: aiError instanceof Error ? aiError.message : "AI connectivity test failed." });
    } finally {
      setTestingAi(false);
    }
  };

  const pollAiLoadTest = async () => {
    try {
      const result = await apiRequest<AiLoadTestResult>("/admin/communication/load-test-ai");
      setAiLoadTest(result);
      if (result.status === "queued" || result.status === "running" || result.status === "cooldown") {
        window.setTimeout(() => void pollAiLoadTest(), 1500);
      }
    } catch (loadError) {
      setAiLoadTest((previous) => previous ? { ...previous, status: "failed", error: loadError instanceof Error ? loadError.message : "Could not read load-test progress." } : null);
    }
  };

  const handleStartAiLoadTest = async () => {
    if (!window.confirm("This will temporarily put controlled load on the home AI server: up to 3 concurrent requests and 17 total requests, with 30-second pauses between stages. Start the load test?")) return;
    setStartingLoadTest(true);
    try {
      const result = await apiRequest<AiLoadTestResult>("/admin/communication/load-test-ai", { method: "POST", timeoutMs: 15_000 });
      setAiLoadTest(result);
      window.setTimeout(() => void pollAiLoadTest(), 500);
    } catch (loadError) {
      setAiLoadTest({ status: "failed", stage: 0, stageTotal: 3, completed: 0, total: 17, successes: 0, failures: 0, error: loadError instanceof Error ? loadError.message : "Could not start load test." });
    } finally {
      setStartingLoadTest(false);
    }
  };

  if (loading && !settings) {
    return (
      <AdminDashboardLayout>
        <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">Loading communication settings…</CardContent>
          </Card>
        </div>
      </AdminDashboardLayout>
    );
  }

  return (
    <AdminDashboardLayout>
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
              <ShieldCheck className="h-4 w-4" />
              Admin-only settings
            </div>
            <div className="flex flex-wrap items-center gap-3"><h1 className="text-3xl font-extrabold tracking-tight">Communication settings</h1>{settings && <Badge variant={settings.enabled ? "default" : "secondary"}>{settings.enabled ? "Email enabled" : "Email paused"}</Badge>}</div>
            <p className="mt-2 max-w-2xl text-muted-foreground">
              Configure how SportPass communicates with participants and organizers. Email is the only channel currently supported.
            </p>
          </div>
          <Button variant="outline" onClick={() => void loadSettings()} disabled={loading} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            {loading ? "Loading…" : "Refresh"}
          </Button>
        </div>

        {error ? (
          <Card>
            <CardContent className="space-y-4 p-6">
              <p role="alert" className="text-sm text-destructive">{error}</p>
              <Button onClick={() => void loadSettings()}>Try again</Button>
            </CardContent>
          </Card>
        ) : settings ? (
          <div className="space-y-6">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border bg-card p-4 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Channel</p><p className="mt-1 font-semibold">Email</p><p className="mt-1 text-xs text-muted-foreground">Gmail API delivery</p></div>
              <div className="rounded-xl border bg-card p-4 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sender</p><p className="mt-1 truncate font-semibold">{settings.sender_name || "Not configured"}</p><p className="mt-1 truncate text-xs text-muted-foreground">{settings.gmail_address || "Add a Gmail address"}</p></div>
              <div className={`rounded-xl border p-4 shadow-sm ${settings.gmail_api_configured ? "border-emerald-200 bg-emerald-50/50" : "border-amber-200 bg-amber-50/50"}`}><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Connection</p><p className="mt-1 font-semibold">{settings.gmail_api_configured ? "OAuth configured" : "Setup required"}</p><p className="mt-1 text-xs text-muted-foreground">Send a test email to confirm delivery</p></div>
            </div>
            {/* Email Configuration Card */}
            <Card>
              <CardHeader>
                <div className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle>Email (Gmail)</CardTitle>
                    <CardDescription className="mt-1">
                      Use your Gmail account to send emails to participants.
                    </CardDescription>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Switch
                      id="email-enabled"
                      checked={settings.enabled}
                      onCheckedChange={(checked) => updateSetting("enabled", checked)}
                    />
                    <Label htmlFor="email-enabled" className="font-normal">
                      Enable
                    </Label>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="sender-name">Sender Name</Label>
                    <Input
                      id="sender-name"
                      value={settings.sender_name || ""}
                      onChange={(e) => updateSetting("sender_name", e.target.value)}
                      placeholder="e.g., SportPass India"
                      disabled={!settings.enabled}
                    />
                    <p className="text-xs text-muted-foreground">Name that appears in the "From" field of emails.</p>
                  </div>

                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="gmail-address">Gmail Address</Label>
                    <Input
                      id="gmail-address"
                      type="email"
                      value={settings.gmail_address || ""}
                      onChange={(e) => updateSetting("gmail_address", e.target.value)}
                      placeholder="your-email@gmail.com"
                      disabled={!settings.enabled}
                    />
                    <p className="text-xs text-muted-foreground">Your Gmail address (not password).</p>
                  </div>

                </div>
                <div className="rounded-lg bg-muted/30 p-4 text-sm">
                  <p className="font-medium">Gmail API connection</p>
                  <p className="mt-2 text-muted-foreground">Emails are sent securely over HTTPS. Authorize the sending Google account once and configure its OAuth credentials in the backend hosting settings.</p>
                  <p className="mt-2 text-xs text-muted-foreground">Required: GMAIL_OAUTH_CLIENT_ID, GMAIL_OAUTH_CLIENT_SECRET, and GMAIL_OAUTH_REFRESH_TOKEN. Use the same Gmail address as the authorized account, or a verified send-as alias. App Passwords are no longer used.</p>
                </div>
              </CardContent>
              <CardFooter className="flex flex-col gap-3 border-t bg-muted/30 px-6 py-4 sm:flex-row sm:justify-between">
                <div className="flex items-center gap-2 text-sm">
                  {settings.gmail_api_configured ? (
                    <>
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      <span className="text-emerald-600">OAuth credentials present — send a test to verify</span>
                    </>
                  ) : (
                    <>
                      <WifiOff className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">Gmail API setup required</span>
                    </>
                  )}
                </div>
                <Button onClick={handleSave} disabled={saving} className="gap-2">
                  <Save className="h-4 w-4" />
                  {saving ? "Saving…" : "Save Settings"}
                </Button>
              </CardFooter>
            </Card>

            {/* Test Email Section */}
            <Card>
              <CardHeader>
                <CardTitle>Send Test Email</CardTitle>
                <CardDescription className="mt-1">
                  Send a test email to verify your configuration is working correctly.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="test-recipient">Recipient Email</Label>
                  <div className="flex gap-2">
                    <Input
                      id="test-recipient"
                      type="email"
                      value={testRecipient}
                      onChange={(e) => setTestRecipient(e.target.value)}
                      placeholder="test@example.com"
                    />
                    <Button
                      onClick={handleSendTest}
                      disabled={sendingTest || !testRecipient || !settings.enabled}
                      className="gap-2"
                    >
                      {sendingTest ? (
                        <>
                          <RefreshCw className="h-4 w-4 animate-spin" /> Sending…
                        </>
                      ) : (
                        <>
                          <Send className="h-4 w-4" /> Send Test
                        </>
                      )}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">Enter an email address to receive a test message.</p>
                </div>

                {testStatus === "success" && (
                  <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 p-3 text-emerald-600">
                    <CheckCircle2 className="h-5 w-5" />
                    <span className="text-sm font-medium">{testMessage}</span>
                  </div>
                )}

                {testStatus === "error" && (
                  <div className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-destructive">
                    <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
                    <div className="text-sm">
                      <p className="font-medium">Test failed</p>
                      <p className="mt-1">{testMessage}</p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="flex items-center gap-2"><Bot className="h-5 w-5" /> Private AI diagnostics</CardTitle><CardDescription className="mt-1">Run a safe connectivity check or a small controlled load test against the configured Ollama server. No event or participant data is used.</CardDescription></div><Badge variant="outline">Admin only</Badge></div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => void handleTestAi()} disabled={testingAi} className="gap-2">
                    {testingAi ? <><RefreshCw className="h-4 w-4 animate-spin" /> Testing AI…</> : <><Bot className="h-4 w-4" /> Test AI</>}
                  </Button>
                  <Button variant="outline" onClick={() => void handleStartAiLoadTest()} disabled={startingLoadTest || ["queued", "running", "cooldown"].includes(aiLoadTest?.status ?? "idle")} className="gap-2">
                    {startingLoadTest ? <><RefreshCw className="h-4 w-4 animate-spin" /> Starting…</> : <><Bot className="h-4 w-4" /> Load Test AI</>}
                  </Button>
                </div>
                {aiResult && (
                  <div className={`rounded-lg p-4 text-sm ${aiResult.success ? "bg-emerald-500/10 text-emerald-700" : "bg-destructive/10 text-destructive"}`}>
                    {aiResult.success ? (
                      <>
                        <p className="font-semibold">AI connection successful · Model available: {aiResult.modelAvailable ? "Yes" : "No"}</p>
                        <p className="mt-2 whitespace-pre-wrap">{aiResult.response}</p>
                        <p className="mt-2 text-xs">Total response time: {aiResult.totalDuration?.toFixed(2)}s{aiResult.modelLoadDuration != null ? ` · Model load: ${aiResult.modelLoadDuration.toFixed(2)}s` : ""}</p>
                      </>
                    ) : <><p className="font-semibold">AI connection failed</p><p className="mt-1">{aiResult.detail}</p></>}
                  </div>
                )}
                {aiLoadTest && aiLoadTest.status !== "idle" && (
                  <div className="space-y-3 rounded-lg border p-4 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-semibold">Load test: {aiLoadTest.status} · Stage {aiLoadTest.stage}/{aiLoadTest.stageTotal}</p>
                      <span className="text-muted-foreground">{aiLoadTest.completed}/{aiLoadTest.total} requests · {aiLoadTest.successes} passed · {aiLoadTest.failures} failed</span>
                    </div>
                    {(aiLoadTest.status === "queued" || aiLoadTest.status === "running" || aiLoadTest.status === "cooldown") && <p className="text-muted-foreground">Controlled test in progress. Cooldown stages are intentional.</p>}
                    {aiLoadTest.error && <p className="text-destructive">{aiLoadTest.error}</p>}
                    {aiLoadTest.stages && aiLoadTest.stages.length > 0 && <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-xs"><thead className="border-b text-muted-foreground"><tr><th className="py-2">Stage</th><th>Concurrency</th><th>Success / Fail</th><th>Avg</th><th>Max</th><th>P95 exploratory</th><th>Tokens/s</th></tr></thead><tbody>{aiLoadTest.stages.map((stage) => <tr key={stage.stage} className="border-b last:border-0"><td className="py-2">{stage.stage}</td><td>{stage.concurrency}</td><td>{stage.successes} / {stage.failures}</td><td>{stage.average == null ? "—" : `${stage.average.toFixed(2)}s`}</td><td>{stage.maximum == null ? "—" : `${stage.maximum.toFixed(2)}s`}</td><td>{stage.p95 == null ? "—" : `${stage.p95.toFixed(2)}s`}</td><td>{stage.tokensPerSecond == null ? "—" : stage.tokensPerSecond.toFixed(1)}</td></tr>)}</tbody></table></div>}
                    {aiLoadTest.status === "completed" && <p className="font-medium text-emerald-700">Estimated recommendation: maximum concurrency {aiLoadTest.recommendation}. Based on this small measurement; not a capacity guarantee.</p>}
                    {aiLoadTest.totalDuration != null && <p className="text-xs text-muted-foreground">Total test duration: {aiLoadTest.totalDuration.toFixed(1)}s</p>}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>WhatsApp</CardTitle>
                <CardDescription className="mt-1">Coming Soon</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-lg border border-dashed p-6 text-center">
                  <div className="mx-auto h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-3">
                    <ShieldCheck className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <p className="text-sm font-medium">WhatsApp integration coming soon</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Planned features:
                  </p>
                  <ul className="text-xs text-muted-foreground mt-2 space-y-1">
                    <li>• Registration confirmation</li>
                    <li>• Ticket confirmation</li>
                    <li>• Payment confirmation</li>
                    <li>• Event updates</li>
                  </ul>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : null}
      </div>
    </AdminDashboardLayout>
  );
};

export default AdminCommunication;
