# Call reminder: 24 hours

The call sweep sends one immediate reminder to each participant once a booked call is within 24 hours of starting. This includes email Off. The line includes the date and time in the reader's time zone. Booking confirmation is a separate notice.

The live site's minimum booking lead remains 24 hours; a booking at that minimum can therefore receive its confirmation and reminder close together. Shorter local test bookings receive their reminder on the next sweep. Cancelled or started calls are excluded. A previous 15-minute reminder counts as already sent, preventing a deployment from repeating it.

Tests cover the exact boundary, just outside it, repeated sweeps, cancellation before generation, legacy deduplication, short local bookings, immediate delivery with email Off and exclusion from later summaries.
