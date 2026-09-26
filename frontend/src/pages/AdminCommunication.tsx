import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, RefreshCw, Save, Send, ShieldCheck, WifiOff } from "lucide-react";
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

const AdminCommunication = () => {
  const [settings, setSettings] = useState<CommunicationSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testRecipient, setTestRecipient] = useState("");
  const [testStatus, setTestStatus] = useState<"idle" | "success" | "error" | null>(null);
  const [testMessage, setTestMessage] = useState("");

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
      const payload: any = {};
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

  const updateSetting = (key: keyof CommunicationSettings, value: any) => {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : null));
    setTestStatus(null);
    setTestMessage("");
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
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
              <ShieldCheck className="h-4 w-4" />
              Admin-only settings
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight">Communication settings</h1>
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

            {/* WhatsApp Coming Soon Card */}
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
