import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Link } from "react-router-dom";

const TermsAndConditions = () => {
  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <Card className="border-0 shadow-lg">
        <CardHeader>
          <CardTitle className="text-2xl font-bold">SportPass Organizer Terms</CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[calc(100vh-200px)] pr-4">
            <div className="prose max-w-none space-y-6">
              <p className="text-sm text-muted-foreground">
                <strong>Last Updated:</strong> January 2026
              </p>

              <div className="border-l-4 border-primary pl-4">
                <p className="font-medium">
                  These Organizer Terms apply to individuals, clubs, communities, businesses and organizations that create or manage events using SportPass India ("SportPass").
                </p>
                <p className="mt-2">
                  By creating or publishing an event on SportPass, you agree to these terms.
                </p>
              </div>

              <h2 className="text-xl font-semibold mt-6">1. Organizer Account</h2>
              <p>
                You must provide accurate and current information when using SportPass.
              </p>
              <p>
                For paid events, SportPass may require additional organizer verification including:
              </p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Organizer or organization name</li>
                <li>Responsible person details</li>
                <li>PAN</li>
                <li>GSTIN, where applicable</li>
                <li>Billing information</li>
                <li>Contact information</li>
              </ul>
              <p>
                Providing false or misleading information may result in paid-event publishing being restricted or the account being suspended.
              </p>

              <h2 className="text-xl font-semibold mt-6">2. Free Events</h2>
              <p>
                A Free Event is an event where participants are <strong>not required to pay any registration fee</strong>.
              </p>
              <p>
                Free Events currently support up to <strong>100 participants</strong> under SportPass's introductory offering.
              </p>
              <p>
                Free Events receive the features shown under the Free plan on the SportPass pricing page.
              </p>
              <p>
                If participants are required to pay any amount in order to register or participate, the event must be created as a <strong>Paid Event</strong>.
              </p>
              <p>
                SportPass may review events that appear to misuse the Free Event offering.
              </p>

              <h2 className="text-xl font-semibold mt-6">3. Paid Events</h2>
              <p>
                A Paid Event is an event where participants are required to pay a registration fee.
              </p>
              <p>
                Current introductory SportPass pricing is:
              </p>
              <div className="bg-primary/5 p-4 rounded-lg border border-primary/20">
                <p className="font-medium">
                  <strong>5% of the registration fee + ₹10 per paid registration.</strong>
                </p>
              </div>
              <p>
                Pricing shown when the event is created or published will apply to that event unless otherwise agreed with SportPass.
              </p>

              <h2 className="text-xl font-semibold mt-6">4. Introductory Pricing</h2>
              <p>
                SportPass's current pricing is introductory pricing and may change in the future.
              </p>
              <p>
                Any pricing changes will apply prospectively and will be communicated before they apply to new events or registrations.
              </p>
              <p>
                Existing event charges will not be changed retrospectively unless required to correct an error.
              </p>

              <h2 className="text-xl font-semibold mt-6">5. Organizer Discounts</h2>
              <p>
                SportPass may provide selected organizers with introductory or promotional discounts.
              </p>
              <ul className="list-disc pl-6 space-y-1">
                <li>May differ between organizers</li>
                <li>May be event-specific</li>
                <li>Are not automatically available to all organizers</li>
                <li>Do not create an entitlement to future discounts</li>
              </ul>
              <p>
                Any applicable discount will be shown or communicated to the organizer.
              </p>

              <h2 className="text-xl font-semibold mt-6">6. Payment Collection</h2>
              <p>
                For Direct UPI events, participant registration payments are made directly to the UPI account configured by the organizer for that event.
              </p>
              <p>
                SportPass does not receive or hold the participant's registration amount under the Direct UPI method.
              </p>
              <p>
                The organizer is responsible for ensuring that the payment details entered for an event are correct.
              </p>
              <p>
                Future payment methods, including online payment gateways, may operate under additional payment and settlement terms.
              </p>

              <h2 className="text-xl font-semibold mt-6">7. SportPass Fees and Billing</h2>
              <p>
                SportPass will calculate applicable platform fees based on paid registrations for the event.
              </p>
              <p>
                SportPass may provide the organizer with a bill or invoice showing:
              </p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Event</li>
                <li>Number of paid registrations</li>
                <li>Applicable platform fees</li>
                <li>Discounts or adjustments</li>
                <li>Amount payable</li>
                <li>Due date</li>
              </ul>
              <p>
                The organizer must pay the amount shown by the due date stated on the bill or invoice.
              </p>

              <h2 className="text-xl font-semibold mt-6">8. Outstanding Payments</h2>
              <p>
                If an organizer has an overdue SportPass balance, SportPass may restrict the organizer from publishing additional paid events until the outstanding amount is cleared.
              </p>
              <p>
                Access to previous event information will not normally be removed solely because an invoice is overdue.
              </p>
              <p>
                SportPass may take further reasonable action to recover valid outstanding amounts.
              </p>

              <h2 className="text-xl font-semibold mt-6">9. Organizer Responsibilities</h2>
              <p>The organizer is responsible for:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Providing accurate event information</li>
                <li>Conducting the event legally and safely</li>
                <li>Obtaining any permissions, licences or approvals required for the event</li>
                <li>Setting registration prices</li>
                <li>Managing cancellations and refunds</li>
                <li>Providing promised event services to participants</li>
                <li>Paying applicable taxes</li>
                <li>Responding to participant queries relating to the event</li>
                <li>Ensuring uploaded content does not violate third-party rights</li>
              </ul>
              <p>
                SportPass provides technology for managing events but is not the organizer or operator of the sporting event itself.
              </p>

              <h2 className="text-xl font-semibold mt-6">10. Cancellations and Refunds</h2>
              <p>
                The organizer is responsible for clearly communicating its event cancellation and refund policy to participants.
              </p>
              <p>
                For Direct UPI events, participant funds are received directly by the organizer. Any participant refund therefore remains the organizer's responsibility unless SportPass explicitly provides another refund mechanism.
              </p>

              <h2 className="text-xl font-semibold mt-6">11. Event Content</h2>
              <p>
                Organizers must not publish:
              </p>
              <ul className="list-disc pl-6 space-y-1">
                <li>False or misleading event information</li>
                <li>Fraudulent events</li>
                <li>Illegal activities</li>
                <li>Content they do not have permission to use</li>
                <li>Content that violates applicable law or the rights of others</li>
              </ul>
              <p>
                SportPass may remove or restrict events reasonably believed to violate these requirements.
              </p>

              <h2 className="text-xl font-semibold mt-6">12. Participant Information</h2>
              <p>
                Organizers may receive participant information necessary to conduct their event.
              </p>
              <p>
                Organizers must use participant information only for legitimate event-related purposes and must protect it from unauthorized access, disclosure or misuse.
              </p>
              <p>
                Use of personal information is also subject to the SportPass Privacy Policy and applicable law.
              </p>

              <h2 className="text-xl font-semibold mt-6">13. SportPass Features</h2>
              <p>
                SportPass may provide features including registrations, participant management, payment tracking, communication, tickets, check-in, sport-specific tools, results and reporting.
              </p>
              <p>
                Features may vary depending on:
              </p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Event type</li>
                <li>Sport</li>
                <li>Pricing plan</li>
                <li>Product availability</li>
                <li>Introductory or promotional programs</li>
              </ul>
              <p>
                Availability of a feature today does not guarantee that the same feature or pricing will remain unchanged indefinitely.
              </p>

              <h2 className="text-xl font-semibold mt-6">14. Service Availability</h2>
              <p>
                SportPass aims to provide a reliable service but does not guarantee uninterrupted or error-free availability.
              </p>
              <p>
                Temporary interruptions may occur due to maintenance, third-party services, internet connectivity or circumstances outside SportPass's reasonable control.
              </p>

              <h2 className="text-xl font-semibold mt-6">15. Suspension or Restriction</h2>
              <p>
                SportPass may restrict or suspend an organizer's ability to create or publish events where there is:
              </p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Fraud or suspected fraud</li>
                <li>False organizer information</li>
                <li>Misuse of the platform</li>
                <li>Outstanding SportPass payments</li>
                <li>Violation of these terms</li>
                <li>Illegal or harmful activity</li>
              </ul>
              <p>
                Where reasonably possible, SportPass will communicate the reason for the restriction.
              </p>

              <h2 className="text-xl font-semibold mt-6">16. Changes to These Terms</h2>
              <p>
                SportPass may update these Organizer Terms as the platform evolves.
              </p>
              <p>
                Material changes will be communicated through the platform or registered organizer contact details.
              </p>
              <p>
                For paid-event publishing, SportPass may require organizers to accept an updated version of these terms.
              </p>

              <h2 className="text-xl font-semibold mt-6">17. Governing Law</h2>
              <p>
                These terms are governed by the laws of India.
              </p>
              <p>
                Any jurisdiction or dispute-resolution details will be specified in the final legally reviewed version of these terms.
              </p>

              <h2 className="text-xl font-semibold mt-6">18. Contact</h2>
              <p>
                Questions regarding these Organizer Terms can be sent to:
              </p>
              <div className="bg-primary/5 p-4 rounded-lg border border-primary/20">
                <p>
                  <strong>SportPass India</strong>
                </p>
                <p className="mt-1">Email: sportpassind@gmail.com</p>
              </div>

              <div className="pt-6 pb-2">
                <Button asChild className="w-full">
                  <Link to="/organizer">I Accept - Return to Dashboard</Link>
                </Button>
              </div>
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
};

export default TermsAndConditions;