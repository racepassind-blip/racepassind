import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Signup from "@/pages/Signup";
import AdminOrganizerApplications from "@/pages/AdminOrganizerApplications";
import { apiRequest } from "@/lib/api";

vi.mock("@/components/Layout", () => ({ Layout: ({children}: {children: React.ReactNode}) => <div>{children}</div> }));
vi.mock("@/components/AdminDashboardLayout", () => ({ AdminDashboardLayout: ({children}: {children: React.ReactNode}) => <div>{children}</div> }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({login: vi.fn()}) }));
vi.mock("@/lib/api", () => ({apiRequest: vi.fn()}));
vi.mock("sonner", () => ({toast: {error: vi.fn(), success: vi.fn()}}));
afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

it("collects payment-route-specific details without showing a false success", () => {
  render(<MemoryRouter initialEntries={["/signup?type=organizer"]}><Signup /></MemoryRouter>);
  fireEvent.change(screen.getByLabelText("How will you collect registration payments?"), {target: {value: "DIRECT_UPI"}});
  expect(screen.getByLabelText("UPI ID")).toBeRequired();
  expect(screen.getByLabelText("Payee name")).toBeRequired();
  fireEvent.change(screen.getByLabelText("How will you collect registration payments?"), {target: {value: "CASHFREE"}});
  expect(screen.queryByLabelText("UPI ID")).not.toBeInTheDocument();
  expect(screen.getByLabelText("PAN")).toBeRequired();
  const submit = screen.getByRole("button", {name: "Submit organizer application"});
  fireEvent.submit(submit.closest("form")!);
  expect(screen.queryByText("Application received")).not.toBeInTheDocument();
  expect(apiRequest).not.toHaveBeenCalled();
});

it("lets an applicant securely check feedback and prefill corrections", async () => {
  vi.mocked(apiRequest).mockResolvedValue({status: "changes_requested", organizationName: "Mysuru Club", applicantName: "Runner", phone: "9876543210", address: "12 Club Road", city: "Mysuru", state: "Karnataka", pincode: "570001", eventHistory: "Monthly running events", paymentPreference: "DIRECT_UPI", paymentDetails: {upiId: "club@bank", payeeName: "Mysuru Club"}, rejectionReason: "Please update your proof", createdAt: "2026-10-17T00:00:00Z"});
  render(<MemoryRouter initialEntries={["/signup?type=organizer&status=1"]}><Signup /></MemoryRouter>);
  fireEvent.change(screen.getByLabelText("Email"), {target: {value: "runner@example.test"}});
  fireEvent.change(screen.getByLabelText("Password"), {target: {value: "test-password"}});
  fireEvent.click(screen.getByRole("button", {name: "Check status"}));
  expect(await screen.findByText("Please update your proof")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", {name: "Edit and resubmit"}));
  expect(screen.getByLabelText("Organization or club name")).toHaveValue("Mysuru Club");
  expect(screen.getByLabelText("UPI ID")).toHaveValue("club@bank");
  expect(screen.getByLabelText("Upload ID proof")).toBeRequired();
});

it("allows admins to inspect completed applications without offering another approval", async () => {
  vi.mocked(apiRequest).mockResolvedValue({items: [{id: "application-1", organizationName: "Mysuru Club", applicantName: "Runner", email: "runner@example.test", status: "approved", paymentDetails: {}, hasIdProof: true}], total: 1});
  render(<MemoryRouter><AdminOrganizerApplications /></MemoryRouter>);
  await screen.findByText("Mysuru Club");
  expect(screen.queryByRole("button", {name: "Approve organizer"})).not.toBeInTheDocument();
  expect(screen.getByRole("button", {name: "Open private proof"})).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", {name: "Approved"}));
  await waitFor(() => expect(apiRequest).toHaveBeenLastCalledWith(expect.stringContaining("status=approved")));
});
