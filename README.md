# Ubuntu Wallet USSD Server

This is a prototype USSD server for the Ubuntu Wallet project. It handles registration, balance checks, sending money, and voucher cash-in with OTP.

## Requirements

- Node.js (version 14 or higher)
- npm or yarn
- A USSD gateway provider (e.g., Africa's Talking) for real deployments
- An SMS provider for OTPs

## Installation

1. Clone the project or copy the files.
2. Install dependencies:

   ```
   npm install
   ```

   or

   ```
   yarn install
   ```

3. Start the server:

   ```
   npm start
   ```

   The server will listen on port 3000 by default. Use environment variable `PORT` to change it.

## Usage

- **USSD**: Configure your USSD gateway to post session data (`sessionId`, `serviceCode`, `phoneNumber`, `text`) to `/ussd`. The server will respond with USSD menus.
- **Voucher creation**: Use the admin endpoint to create vouchers:

  ```
  POST /admin/voucher
  Body: { "code": "VOUCHER123", "amount": 100 }
  ```

- **Status**: Check server status:

  ```
  GET /status
  ```

## Notes

- This is a prototype. In production, replace the `sendSmsMock` function with a real SMS provider integration.
- Data is stored in a JSON file (`db.json`). For production, replace with a proper database.
- Use secure hosting with HTTPS.
