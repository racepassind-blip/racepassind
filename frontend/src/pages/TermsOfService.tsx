import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Link } from "react-router-dom";

const TermsOfService = () => {
  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <Card className="border-0 shadow-lg">
        <CardHeader>
          <CardTitle className="text-2xl font-bold">Terms of Service</CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[calc(100vh-200px)] pr-4">
            <div className="prose max-w-none space-y-6">
              <p className="text-sm text-muted-foreground">
                <strong>Last Updated:</strong> 20 September 2026
              </p>

              <p>Welcome to <strong>SportPass India</strong>.</p>
              <p>These Terms of Service ("Terms") govern your access to and use of <strong>SportPass India</strong>, including our website, applications, event registration services, organizer tools and related features.</p>
              <p>By accessing or using SportPass India, creating an account, registering for an event or creating/managing an event, you agree to these Terms.</p>
              <p>If you do not agree with these Terms, please do not use SportPass India.</p>

              <h2 className="text-xl font-semibold mt-6">1. About SportPass India</h2>
              <p>SportPass India is a technology platform designed to help participants discover and register for sports events and help organizers manage their events.</p>
              <p>Depending on the event and features enabled, SportPass India may provide tools for:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Event discovery</li>
                <li>Event registration</li>
                <li>Participant management</li>
                <li>Direct UPI payment coordination</li>
                <li>Payment verification</li>
                <li>Categories and entries</li>
                <li>Bib, player, team or group allocation</li>
                <li>Add-ons and merchandise</li>
                <li>Event-day check-in</li>
                <li>Event-item or goodie distribution</li>
                <li>Match or activity management</li>
                <li>Courts, groups or checkpoints</li>
                <li>Scores and timings</li>
                <li>Rankings, brackets and standings</li>
                <li>Results</li>
                <li>Organizer reporting and exports</li>
                <li>Event communication</li>
              </ul>
              <p>Not every event uses every SportPass feature.</p>
              <p>SportPass India provides the <strong>technology platform</strong>. Unless specifically stated otherwise, SportPass India is <strong>not the organizer, owner or operator of events listed on the platform</strong>.</p>

              <h2 className="text-xl font-semibold mt-6">2. Who Can Use SportPass India</h2>
              <p>You may use SportPass India if you are legally capable of entering into an agreement under applicable law.</p>
              <p>Participants under the age of 18 may only register where permitted by the event and where the registration is completed or authorized by a parent, legal guardian or other person legally permitted to provide such authorization.</p>
              <p>If you register another person, teammate, family member or group participant, you confirm that you are authorized to provide their information and register them for the event.</p>

              <h2 className="text-xl font-semibold mt-6">3. User Accounts</h2>
              <p>Certain SportPass India features may require an account.</p>
              <p>You are responsible for:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Providing accurate information</li>
                <li>Keeping your account information updated</li>
                <li>Protecting your password and login credentials</li>
                <li>Preventing unauthorized use of your account</li>
                <li>Informing us if you believe your account has been compromised</li>
              </ul>
              <p>You are responsible for activities performed through your account unless caused by circumstances outside your reasonable control.</p>
              <p>SportPass India may suspend or restrict accounts where we reasonably believe there is:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Fraud</li>
                <li>Misuse</li>
                <li>Unauthorized activity</li>
                <li>Violation of these Terms</li>
                <li>Abuse of organizers, participants or the platform</li>
                <li>Activity that threatens platform security</li>
              </ul>

              <h2 className="text-xl font-semibold mt-6">4. Event Listings</h2>
              <p>Events listed on SportPass India may be created and managed by independent event organizers.</p>
              <p>Organizers are responsible for ensuring that information provided about their events is accurate and not misleading.</p>
              <p>Event information may include:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Event name</li>
                <li>Location</li>
                <li>Date and time</li>
                <li>Categories</li>
                <li>Registration fees</li>
                <li>Eligibility criteria</li>
                <li>Participant requirements</li>
                <li>Rules</li>
                <li>Schedules</li>
                <li>Prizes</li>
                <li>Add-ons</li>
                <li>Refund policies</li>
                <li>Safety requirements</li>
                <li>Event instructions</li>
              </ul>
              <p>Participants should review the event information carefully before registering.</p>
              <p>SportPass India does not guarantee that every event will take place exactly as originally described. Event details may change due to decisions made by the organizer or circumstances affecting the event.</p>

              <h2 className="text-xl font-semibold mt-6">5. Event Registration</h2>
              <p>When registering for an event, you agree to provide complete and accurate information.</p>
              <p>Registration may require information such as:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Participant details</li>
                <li>Age or date of birth</li>
                <li>Gender</li>
                <li>Category</li>
                <li>Team or club</li>
                <li>Emergency contact</li>
                <li>Jersey size</li>
                <li>Meal preferences</li>
                <li>Equipment information</li>
                <li>Sports-specific questions</li>
                <li>Add-ons</li>
                <li>Other information reasonably required for the event</li>
              </ul>
              <p>Different events may require different information.</p>
              <p>A registration is not necessarily considered confirmed immediately after submission. Depending on the event, confirmation may depend on:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Successful payment</li>
                <li>Organizer payment verification</li>
                <li>Eligibility checks</li>
                <li>Capacity availability</li>
                <li>Organizer approval</li>
                <li>Completion of required participant information</li>
              </ul>
              <p>The registration status shown on SportPass India should be used to understand the current state of the registration.</p>

              <h2 className="text-xl font-semibold mt-6">6. Multiple Participant and Team Registrations</h2>
              <p>SportPass India may allow a user to register multiple participants, teams or groups in a single registration.</p>
              <p>The person submitting the registration is responsible for ensuring that:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>The participant information is accurate</li>
                <li>They have permission to submit the information</li>
                <li>All participants understand relevant event requirements</li>
                <li>Applicable fees are paid</li>
                <li>Eligibility requirements are met</li>
              </ul>
              <p>Event organizers may reject or modify registrations that do not satisfy event rules.</p>

              <h2 className="text-xl font-semibold mt-6">7. Payments</h2>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <p className="font-semibold">SportPass India is a technology platform, not a payment processor or payment intermediary.</p>
                <p className="mt-2">All payments for event registrations are made directly between participants and event organizers. SportPass India does not collect, hold, process or control registration fees paid by participants.</p>
              </div>
              <p className="mt-4">Payment methods depend on the event.</p>
              <p>Some events allow participants to pay the organizer directly using UPI.</p>
              <p>Where direct UPI is used:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>The participant pays the organizer directly — SportPass India is not a party to this transaction</li>
                <li>SportPass India may display payment instructions or a UPI payment request on behalf of the organizer</li>
                <li>The participant may be required to submit a UTR or transaction reference number</li>
                <li>The organizer is responsible for verifying whether payment was actually received</li>
                <li>SportPass India does not receive, hold or process the participant's registration funds</li>
              </ul>
              <p className="font-medium mt-2">SportPass India will never ask for your UPI PIN, banking password or OTP. Never share these with anyone.</p>
              <p>Participants should always verify the payment recipient and amount before authorizing any payment.</p>

              <h2 className="text-xl font-semibold mt-6">8. Payment Disputes</h2>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <p className="font-semibold">SportPass India is not responsible for payment disputes between participants and organizers.</p>
                <p className="mt-2">Because registration payments go directly from participants to organizers, SportPass India is not a party to those transactions and has no control over whether payment is sent, received or verified correctly.</p>
              </div>
              <p className="mt-4">Where an organizer manually verifies payments, a submitted payment reference does not by itself confirm that registration has been completed.</p>
              <p>The registration may remain pending until the organizer verifies receipt of payment. The organizer is solely responsible for confirming whether payment was actually received.</p>
              <p>If there is a dispute about a payment made directly to an organizer, the participant and organizer must resolve it directly with each other. SportPass India may provide available platform records as a reference but cannot intervene in, mediate or resolve financial disputes between participants and organizers.</p>

              <h2 className="text-xl font-semibold mt-6">9. Registration Fees and Platform Fees</h2>
              <p>An event may include:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Organizer registration fees</li>
                <li>SportPass platform or service fees</li>
                <li>Taxes, where applicable</li>
                <li>Add-on charges</li>
                <li>Other clearly disclosed event-related charges</li>
              </ul>
              <p>Where a SportPass service fee is charged to participants, the applicable amount should be displayed before registration or payment is completed.</p>
              <p>Where the organizer chooses to bear the SportPass fee, it may instead be billed to the organizer.</p>
              <p>SportPass India may change its pricing from time to time. Changes will not normally affect charges already finalized for an existing transaction unless otherwise agreed.</p>

              <h2 className="text-xl font-semibold mt-6">10. Cancellations and Refunds</h2>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <p className="font-semibold">SportPass India does not issue refunds for event registrations.</p>
                <p className="mt-2">All refund and cancellation decisions rest entirely with the event organizer. Participants must contact the organizer directly regarding any refund request.</p>
              </div>
              <p className="mt-4">Event cancellation and refund policies are set and managed by the relevant <strong>event organizer</strong>, not SportPass India.</p>
              <p>Participants should review the refund and cancellation policy displayed for the event before completing registration.</p>
              <p>Depending on the organizer's policy:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Registration fees may be refundable</li>
                <li>Registration fees may be partially refundable</li>
                <li>Registration fees may be non-refundable</li>
                <li>Transfers to another participant may or may not be allowed</li>
                <li>Deferral to another event may or may not be allowed</li>
              </ul>
              <p>Where payment was made directly to an organizer, any refund must be issued by that organizer. SportPass India has no access to those funds and cannot process or guarantee any refund.</p>

              <h2 className="text-xl font-semibold mt-6">11. Event Cancellation, Postponement or Changes</h2>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <p className="font-semibold">SportPass India is not responsible for event cancellations, postponements or changes.</p>
                <p className="mt-2">Events are organized and operated by independent organizers. SportPass India has no control over whether an event takes place, is cancelled, postponed or modified.</p>
              </div>
              <p className="mt-4">Sports events may be affected by circumstances such as:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Weather</li>
                <li>Safety concerns</li>
                <li>Venue availability</li>
                <li>Government restrictions</li>
                <li>Natural events</li>
                <li>Operational problems</li>
                <li>Insufficient participation</li>
                <li>Organizer decisions</li>
                <li>Other circumstances outside SportPass India's control</li>
              </ul>
              <p>The organizer is responsible for communicating any changes and determining any applicable refund, credit or transfer policy.</p>
              <p>SportPass India is not liable for any costs incurred by participants as a result of an event being changed, postponed or cancelled — including travel, accommodation, equipment or any other expenses.</p>

              <h2 className="text-xl font-semibold mt-6">12. Event Participation and Safety</h2>
              <p>Participation in sports and physical activities may involve inherent risks.</p>
              <p>Participants are responsible for assessing whether they are physically capable of participating in an event.</p>
              <p>Participants must:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Follow organizer instructions</li>
                <li>Follow event rules</li>
                <li>Follow applicable safety requirements</li>
                <li>Use appropriate equipment where required</li>
                <li>Provide accurate health or emergency information where requested</li>
                <li>Act responsibly toward other participants, volunteers, staff and the public</li>
              </ul>
              <p>SportPass India does not provide medical advice and does not determine whether a participant is medically fit to participate.</p>
              <p>Where an event requires medical certificates, waivers or other eligibility documentation, responsibility for reviewing those requirements lies with the organizer.</p>

              <h2 className="text-xl font-semibold mt-6">13. Event Organizer Responsibilities</h2>
              <p>Organizers using SportPass India are responsible for their events. This includes responsibility for:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Accuracy of event information</li>
                <li>Obtaining necessary permissions</li>
                <li>Venue arrangements</li>
                <li>Safety</li>
                <li>Staffing and volunteers</li>
                <li>Participant eligibility</li>
                <li>Event rules</li>
                <li>Payment collection</li>
                <li>Payment verification</li>
                <li>Refunds</li>
                <li>Prizes</li>
                <li>Logistics</li>
                <li>Medical or emergency arrangements</li>
                <li>Compliance with applicable laws</li>
                <li>Required licenses or permissions</li>
                <li>Results and scoring</li>
                <li>Communication with participants</li>
              </ul>
              <p>SportPass India provides tools that may assist organizers but does not take over the organizer's legal or operational responsibilities.</p>

              <h2 className="text-xl font-semibold mt-6">14. Organizer Use of Participant Information</h2>
              <p>Organizers may access participant information where necessary to operate their events.</p>
              <p>Organizers agree to use participant information only for legitimate purposes related to the event or as otherwise permitted by applicable law.</p>
              <p>Organizers must not misuse participant information, including for:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Unauthorized marketing</li>
                <li>Sale of participant databases</li>
                <li>Unrelated commercial activity</li>
                <li>Harassment</li>
                <li>Fraud</li>
                <li>Unlawful profiling</li>
                <li>Other unauthorized purposes</li>
              </ul>
              <p>Organizers are responsible for information they export from SportPass India.</p>

              <h2 className="text-xl font-semibold mt-6">15. Event Vendors and Partners</h2>
              <p>Organizers may need to share limited participant information with service providers involved in operating an event. Examples may include:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Timing providers</li>
                <li>Scoring teams</li>
                <li>Venue teams</li>
                <li>Check-in teams</li>
                <li>Event staff</li>
                <li>Volunteers</li>
                <li>Kit or merchandise teams</li>
                <li>Logistics providers</li>
              </ul>
              <p>Organizers are responsible for ensuring that information shared with third parties is appropriate and reasonably necessary for the relevant purpose.</p>

              <h2 className="text-xl font-semibold mt-6">16. Check-In and Event-Day Operations</h2>
              <p>SportPass India may provide tools for participant verification and check-in.</p>
              <p>Check-in may use:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>QR codes</li>
                <li>Registration references</li>
                <li>Bib numbers</li>
                <li>Participant names</li>
                <li>Other event identifiers</li>
              </ul>
              <p>A successful digital check-in does not replace any additional safety, identity or eligibility verification required by the organizer.</p>
              <p>Organizers remain responsible for event admission decisions.</p>

              <h2 className="text-xl font-semibold mt-6">17. Bibs, Player Numbers and Other Allocations</h2>
              <p>SportPass India may allow organizers to allocate identifiers or resources such as:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Bib numbers</li>
                <li>Player numbers</li>
                <li>Courts</li>
                <li>Matches</li>
                <li>Teams</li>
                <li>Groups</li>
                <li>Waves</li>
                <li>Start slots</li>
                <li>Checkpoints</li>
                <li>Other event-specific allocations</li>
              </ul>
              <p>Such allocations may be changed by the organizer.</p>
              <p>SportPass India does not guarantee that an allocation displayed earlier will remain unchanged until the event begins.</p>

              <h2 className="text-xl font-semibold mt-6">18. Event Items and Add-Ons</h2>
              <p>Some events may offer:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Jerseys</li>
                <li>T-shirts</li>
                <li>Meals</li>
                <li>Goodie kits</li>
                <li>Merchandise</li>
                <li>Accommodation</li>
                <li>Equipment</li>
                <li>Other add-ons</li>
              </ul>
              <p>Availability may depend on organizer stock and event conditions.</p>
              <p>SportPass India may help record a participant's selection or whether an item has been distributed, but the organizer is responsible for supplying the item or service.</p>

              <h2 className="text-xl font-semibold mt-6">19. Results, Scores and Timings</h2>
              <p>SportPass India may provide tools for recording and publishing:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Scores</li>
                <li>Timings</li>
                <li>Rankings</li>
                <li>Positions</li>
                <li>Match outcomes</li>
                <li>Brackets</li>
                <li>Standings</li>
                <li>Other event results</li>
              </ul>
              <p>Results are generally entered, imported, verified or approved by the event organizer or their appointed service providers.</p>
              <p>SportPass India does not independently guarantee the accuracy of results supplied by organizers, officials, timing providers or scoring teams.</p>
              <p>An organizer may correct results where an error is identified. Official results are determined by the organizer according to the applicable event rules.</p>

              <h2 className="text-xl font-semibold mt-6">20. Public Results</h2>
              <p>Certain event results may be publicly accessible. Public result pages may display information such as:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Participant name</li>
                <li>Bib or player number</li>
                <li>Category</li>
                <li>Team or club</li>
                <li>Score</li>
                <li>Timing</li>
                <li>Position</li>
                <li>Ranking</li>
                <li>Match result</li>
                <li>Bracket</li>
                <li>Standing</li>
              </ul>
              <p>By participating in an event where results are publicly published, you acknowledge that information reasonably required to identify and display the result may be made public.</p>
              <p>Personal contact information such as email addresses or phone numbers should not ordinarily be displayed as part of public results.</p>

              <h2 className="text-xl font-semibold mt-6">21. Organizer Billing</h2>
              <p>SportPass India may charge organizers for use of the platform.</p>
              <p>Pricing may be based on factors such as:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Number of confirmed registrations</li>
                <li>Event size</li>
                <li>Selected plan</li>
                <li>Platform services used</li>
                <li>Other published pricing criteria</li>
              </ul>
              <p>Applicable pricing should be shown to the organizer through the platform or agreed separately.</p>
              <p>SportPass India may provide discounts, promotional codes, complimentary use or fee waivers at its discretion.</p>
              <p>Unless otherwise stated, such discounts or waivers:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Apply only to the applicable event or account</li>
                <li>Have no cash value</li>
                <li>May have expiry dates or usage limits</li>
                <li>Do not guarantee future discounts</li>
              </ul>
              <p>Unpaid organizer bills may result in restrictions on organizer features or future event creation.</p>

              <h2 className="text-xl font-semibold mt-6">22. Acceptable Use</h2>
              <p>You must not use SportPass India to:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Commit fraud</li>
                <li>Submit false registrations</li>
                <li>Provide fake payment references</li>
                <li>Impersonate another person or organization</li>
                <li>Scrape participant information</li>
                <li>Send spam</li>
                <li>Harass users</li>
                <li>Distribute malware</li>
                <li>Attempt unauthorized access</li>
                <li>Interfere with platform operation</li>
                <li>Circumvent security controls</li>
                <li>Misuse organizer or participant information</li>
                <li>Conduct unlawful activity</li>
              </ul>
              <p>SportPass India may investigate suspected misuse and take appropriate action.</p>

              <h2 className="text-xl font-semibold mt-6">23. Content Uploaded to SportPass India</h2>
              <p>Users and organizers may upload information, images, logos, descriptions or other content.</p>
              <p>You retain ownership of content that belongs to you.</p>
              <p>By uploading content required to operate or promote an event, you grant SportPass India a limited right to host, display, process, reproduce and distribute that content as reasonably necessary to provide the platform and associated event services.</p>
              <p>You must not upload content that:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Infringes intellectual property rights</li>
                <li>Is unlawful</li>
                <li>Is fraudulent</li>
                <li>Contains malicious code</li>
                <li>Violates another person's privacy</li>
                <li>Is abusive or harmful</li>
              </ul>

              <h2 className="text-xl font-semibold mt-6">24. SportPass India Intellectual Property</h2>
              <p>SportPass India and its associated:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Name</li>
                <li>Branding</li>
                <li>Logo</li>
                <li>Website design</li>
                <li>Software</li>
                <li>Platform features</li>
                <li>Source code</li>
                <li>Documentation</li>
                <li>Original content</li>
              </ul>
              <p>are owned by SportPass India or its applicable licensors unless otherwise stated.</p>
              <p>You may not copy, reproduce, reverse engineer, sell or commercially exploit SportPass India technology or branding without permission, except where permitted by applicable law.</p>

              <h2 className="text-xl font-semibold mt-6">25. Third-Party Services</h2>
              <p>SportPass India may integrate with third-party services such as:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>UPI applications</li>
                <li>Payment providers</li>
                <li>Email providers</li>
                <li>Cloud infrastructure</li>
                <li>Mapping providers</li>
                <li>Analytics services</li>
                <li>Storage providers</li>
              </ul>
              <p>Your use of third-party services may also be subject to their own terms and privacy policies.</p>
              <p>SportPass India is not responsible for third-party services that are outside our control.</p>

              <h2 className="text-xl font-semibold mt-6">26. Platform Availability</h2>
              <p>We aim to keep SportPass India available and reliable, but we do not guarantee uninterrupted access.</p>
              <p>The platform may occasionally be unavailable because of:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Maintenance</li>
                <li>Updates</li>
                <li>Infrastructure issues</li>
                <li>Network failures</li>
                <li>Security incidents</li>
                <li>Third-party service failures</li>
                <li>Circumstances outside our control</li>
              </ul>
              <p>We may modify, add or discontinue platform features as SportPass India evolves.</p>

              <h2 className="text-xl font-semibold mt-6">27. No Guarantee of Events or Participation</h2>
              <p>Listing an event on SportPass India does not mean that SportPass India endorses, guarantees or certifies that event.</p>
              <p>We do not guarantee:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Event quality</li>
                <li>Organizer performance</li>
                <li>Participant experience</li>
                <li>Event safety</li>
                <li>Availability of prizes</li>
                <li>Accuracy of organizer claims</li>
                <li>Acceptance of every registration</li>
                <li>Completion of an event</li>
                <li>Particular sporting outcomes</li>
              </ul>
              <p>Participants should use their own judgment when deciding whether to participate.</p>

              <h2 className="text-xl font-semibold mt-6">28. Disclaimer of Warranties</h2>
              <p>SportPass India is provided on an <strong>"as available"</strong> and <strong>"as is"</strong> basis to the extent permitted by applicable law.</p>
              <p>While we work to provide a reliable service, we cannot guarantee that the platform will always be:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Error-free</li>
                <li>Uninterrupted</li>
                <li>Completely secure</li>
                <li>Free from delays</li>
                <li>Compatible with every device</li>
                <li>Accurate where information originates from third parties</li>
              </ul>
              <p>Nothing in these Terms excludes rights that cannot legally be excluded under applicable law.</p>

              <h2 className="text-xl font-semibold mt-6">29. Limitation of Liability</h2>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <p className="font-semibold">SportPass India is a technology service provider. We are not the event organizer, not the payment processor and not responsible for what happens between participants and organizers.</p>
              </div>
              <p className="mt-4">To the maximum extent permitted by applicable law, SportPass India will not be liable for any loss or damage arising from:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Payment disputes between participants and organizers</li>
                <li>Failure of an organizer to refund registration fees</li>
                <li>Event cancellation, postponement or modification by an organizer</li>
                <li>Organizer conduct or failure to deliver promised event services</li>
                <li>Participant conduct at or related to an event</li>
                <li>Travel, accommodation, equipment or other expenses incurred by participants</li>
                <li>Incorrect or misleading information provided by organizers</li>
                <li>Results, scoring or timing disputes</li>
                <li>Direct payments made between participants and organizers outside SportPass India's control</li>
                <li>Third-party services used in connection with an event</li>
                <li>Temporary platform unavailability</li>
                <li>Loss of data or content not caused directly by SportPass India</li>
              </ul>
              <p>Nothing in these Terms is intended to exclude or limit liability where such exclusion or limitation is not permitted by applicable law.</p>

              <h2 className="text-xl font-semibold mt-6">30. Indemnity</h2>
              <p>To the extent permitted by law, organizers agree to be responsible for claims arising from their:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Events</li>
                <li>Event operations</li>
                <li>Content</li>
                <li>Violation of applicable laws</li>
                <li>Misuse of participant information</li>
                <li>Violation of third-party rights</li>
                <li>Breach of these Terms</li>
              </ul>
              <p>Users are similarly responsible for claims resulting from their unlawful use of SportPass India or material breach of these Terms.</p>

              <h2 className="text-xl font-semibold mt-6">31. Suspension and Termination</h2>
              <p>SportPass India may suspend or terminate access where reasonably necessary because of:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Serious or repeated violation of these Terms</li>
                <li>Fraud or suspected fraud</li>
                <li>Security risks</li>
                <li>Abuse of the platform</li>
                <li>Non-payment of applicable organizer fees</li>
                <li>Legal requirements</li>
                <li>Harm to SportPass India or other users</li>
              </ul>
              <p>Where reasonable and appropriate, we may provide notice before taking such action.</p>
              <p>You may stop using SportPass India at any time.</p>
              <p>Certain provisions relating to payments, intellectual property, liability, disputes and other matters that reasonably need to survive termination will continue to apply.</p>

              <h2 className="text-xl font-semibold mt-6">32. Privacy</h2>
              <p>Your use of SportPass India is also governed by our <strong>Privacy Policy</strong>.</p>
              <p>The Privacy Policy explains how personal information may be collected, processed, stored and shared through SportPass India. Users and organizers should review the Privacy Policy before using the platform.</p>

              <h2 className="text-xl font-semibold mt-6">33. Changes to These Terms</h2>
              <p>SportPass India may update these Terms as the platform evolves or legal and operational requirements change.</p>
              <p>When material changes are made, we will update the <strong>Last Updated</strong> date.</p>
              <p>Where appropriate, we may provide additional notice.</p>
              <p>Continued use of SportPass India after updated Terms become effective constitutes acceptance of those Terms, subject to applicable law.</p>

              <h2 className="text-xl font-semibold mt-6">34. Governing Law</h2>
              <p>These Terms are governed by the laws of <strong>India</strong>.</p>
              <p>Any disputes will be subject to the jurisdiction of the competent courts in <strong>Mysuru, Karnataka, India</strong>, unless applicable law requires otherwise.</p>

              <h2 className="text-xl font-semibold mt-6">35. Contact Us</h2>
              <p>Questions about these Terms may be sent to:</p>
              <div className="bg-primary/5 p-4 rounded-lg border border-primary/20">
                <p className="font-medium"><strong>SportPass India</strong></p>
                <p className="mt-1">Email: sportpassind@gmail.com</p>
                <p className="mt-1">Website: https://sportpassindia.com/</p>
              </div>

              <div className="border-l-4 border-primary pl-4 mt-6">
                <p className="font-medium">Important Event Registration Notice</p>
                <p className="mt-2">
                  By completing this registration, you agree to the SportPass India Terms of Service and Privacy Policy and acknowledge that the event is organized by the event organizer. Event rules, cancellations and refunds are subject to the organizer's applicable policies.
                </p>
              </div>

              <div className="border-l-4 border-primary pl-4 mt-6">
                <p className="font-medium">Organizer Acceptance Notice</p>
                <p className="mt-2">
                  By publishing this event, you confirm that the event information is accurate, that you are authorized to organize the event, and that you accept responsibility for event operations, participant safety, payments, refunds and compliance with applicable requirements. You also agree to the SportPass India Terms of Service and Privacy Policy.
                </p>
              </div>

              <div className="pt-6 pb-2">
                <Button asChild className="w-full">
                  <Link to="/">Return to Home</Link>
                </Button>
              </div>
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
};

export default TermsOfService;