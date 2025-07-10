import axios from "axios";
import { GraphServiceBase } from "./services/GraphClient";
import logger from "./utils/logger";
import { table } from "table";
import chalk from "chalk";
import jwt from "jsonwebtoken";
import ora from "ora";
import { sendOtpEmail } from "./utils/email";
import inquirer from "inquirer";

interface User {
  id: number;
  displayName?: string;
  mail?: string;
  userPrincipalName?: string;
  extension_8d70fb4f813c44f08d13356ad1d46c2b_User_id?: number;
  creationType?: string;
  createdDateTime?: string;
  deletedDateTime?: string;
}

export class UserManager extends GraphServiceBase {
  constructor() {
    super();
  }

  private currentToken: string | null = null;

  private createSpinner(text: string) {
    return ora({ text, spinner: "dots" }).start();
  }

  public async verifyLogin(email: string): Promise<string | null> {
    const otpStore = new Map<string, string>();
    await this.initialize();
    const spinner = this.createSpinner(`Checking Entra ID for ${email}...`);

    try {
      const response = await axios.get(`${this.graphRoot}users`, {
        headers: { Authorization: `Bearer ${this.token}` },
        params: {
          $filter: `creationType eq 'LocalAccount'`,
          $select:
            "id,mail,userPrincipalName,displayName,creationType,extension_8d70fb4f813c44f08d13356ad1d46c2b_User_id",
          $top: 999,
        },
      });

      const users: User[] = response.data?.value || [];

      const matchedUser = users.find(
        (user) =>
          user.mail?.toLowerCase() === email.toLowerCase() ||
          user.userPrincipalName?.toLowerCase() === email.toLowerCase()
      );

      if (!matchedUser) {
        spinner.fail("User not found in Entra ID LocalAccounts.");
        return null;
      }

      spinner.succeed("User found. Sending OTP...");

      // Generate and store OTP
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      otpStore.set(email, otp);

      try {
        await sendOtpEmail(email, otp);
      } catch (emailErr) {
        logger.error("Failed to send OTP email:", emailErr);
        return null;
      }

      // Prompt for OTP
      const { inputOtp } = await inquirer.prompt([
        {
          type: "input",
          name: "inputOtp",
          message: `Enter the 6-digit OTP sent to ${email}:`,
          validate(input) {
            return /^\d{6}$/.test(input) || "Please enter a valid 6-digit OTP.";
          },
        },
      ]);

      if (inputOtp !== otpStore.get(email)) {
        logger.error("Invalid OTP.");
        return null;
      }

      otpStore.delete(email);

      const jwtToken = jwt.sign(
        {
          username: matchedUser.mail || matchedUser.userPrincipalName,
          id:
            matchedUser["extension_8d70fb4f813c44f08d13356ad1d46c2b_User_id"] ||
            matchedUser.id,
          creationType: matchedUser.creationType,
        },
        "qwertyuiopasdfghjklzxcvbnm123456",
        { expiresIn: "2h" }
      );

      this.currentToken = jwtToken;
      logger.info("Login successful. JWT generated.");
      return jwtToken;
    } catch (error: any) {
      spinner.fail("Error during authentication.");
      logger.error(`verifyLogin error: ${error.message}`);
      return null;
    }
  }

  public getCurrentSession(): { username: string; id: string } | null {
    try {
      if (!this.currentToken) return null;
      return jwt.verify(
        this.currentToken,
        "qwertyuiopasdfghjklzxcvbnm123456"
      ) as {
        username: string;
        id: string;
      };
    } catch {
      return null;
    }
  }

  public async listUsers(): Promise<void> {
    await this.initialize();
    const spinner = await this.createSpinner("Fetching LocalAccount users...");

    try {
      const response = await axios.get(`${this.graphRoot}users`, {
        headers: { Authorization: `Bearer ${this.token}` },
        params: {
          $select:
            "displayName,mail,userPrincipalName,extension_8d70fb4f813c44f08d13356ad1d46c2b_User_id,creationType,createdDateTime",
          $top: 999,
        },
      });

      spinner.succeed("Fetched active users.");

      const users: User[] = response.data?.value || [];

      if (users.length > 0) {
        const tableData = users.map((user, index) => [
          index + 1,
          user.displayName || "-",
          user.mail || user.userPrincipalName || "-",
          user.extension_8d70fb4f813c44f08d13356ad1d46c2b_User_id || "-",
          user.creationType || "-",
          new Date(user.createdDateTime!).toLocaleString() || "-",
        ]);

        const output = table([
          [
            "ID",
            "Name",
            "Email",
            "Webportal_ID",
            "Account_Type",
            "createdDateTime",
          ],
          ...tableData,
        ]);
        logger.info("Active Users:\n" + output);
      } else {
        logger.warn("No users found.");
      }
    } catch (error: any) {
      spinner.fail("Failed to fetch users.");
      logger.error(`Error listing users: ${error.message}`);
    }
  }

  public async deleteUserByWebportalId(webportalId: number): Promise<boolean> {
    await this.initialize();
    const spinner = await this.createSpinner(
      `Deleting user with Webportal ID: ${webportalId}...`
    ).start();

    try {
      const extensionAttr =
        "extension_8d70fb4f813c44f08d13356ad1d46c2b_User_id";
      const filter = `${extensionAttr} eq '${webportalId}' and creationType eq 'LocalAccount'`;

      const response = await axios.get(`${this.graphRoot}users`, {
        headers: { Authorization: `Bearer ${this.token}` },
        params: {
          $filter: filter,
          $select: `id,mail,userPrincipalName,${extensionAttr},creationType`,
        },
      });

      const user = response.data?.value?.[0];
      if (!user) {
        spinner.fail(
          `No LocalAccount user found with Webportal ID: ${webportalId}`
        );
        return false;
      }

      await axios.delete(`${this.graphRoot}users/${user.id}`, {
        headers: { Authorization: `Bearer ${this.token}` },
      });

      spinner.succeed(
        `Deleted user: ${chalk.green(user.mail)} (Webportal ID: ${webportalId})`
      );
      return true;
    } catch (error: any) {
      spinner.fail(`Failed to delete user with Webportal ID: ${webportalId}`);
      logger.error(`Error deleting user: ${error.message}`);
      return false;
    }
  }

  public async deleteMultipleUsers(webportalIds: number[]): Promise<void> {
    let deletedAny = false;
    let count = 0;

    for (const id of webportalIds) {
      const wasDeleted = await this.deleteUserByWebportalId(id);
      if (wasDeleted) {
        deletedAny = true;
        count += 1;
      }
    }

    if (deletedAny) {
      logger.info(`${count} user(s) deleted. Fetching updated user list...\n`);
      await this.listUsers();
    }
  }

  public async deleteLocalAccountUserById(userId: string): Promise<boolean> {
    await this.initialize();
    const spinner = await this.createSpinner(
      `Deleting user with ID: ${userId}...`
    ).start();

    try {
      const response = await axios.get(`${this.graphRoot}users/${userId}`, {
        headers: { Authorization: `Bearer ${this.token}` },
        params: {
          $filter: `creationType eq 'LocalAccount'`,
          $select: "id,userPrincipalName,creationType",
        },
      });

      const user = response.data;
      if (!user) {
        spinner.fail(`User not found with ID: ${userId}`);
        return false;
      }

      if (user.creationType !== "LocalAccount") {
        spinner.fail(`User ${user.userPrincipalName} is not a LocalAccount.`);
        return false;
      }

      await axios.delete(`${this.graphRoot}users/${userId}`, {
        headers: { Authorization: `Bearer ${this.token}` },
      });

      spinner.succeed(`Deleted LocalAccount user: ${user.userPrincipalName}`);
      return true;
    } catch (error: any) {
      spinner.fail(`Failed to delete user: ${userId}`);
      logger.error(`Error deleting user: ${error.message}`);
      return false;
    }
  }

  public async deleteAllLocalAccountUsers(): Promise<void> {
    await this.initialize();
    const spinner = await this.createSpinner(
      "Fetching LocalAccount users..."
    ).start();

    try {
      const response = await axios.get(`${this.graphRoot}users`, {
        headers: { Authorization: `Bearer ${this.token}` },
        params: {
          $filter: `creationType eq 'LocalAccount'`,
          $select: "id,userPrincipalName,creationType",
          $top: 999,
        },
      });

      const users = response.data?.value || [];
      spinner.succeed(`Fetched ${users.length} LocalAccount user(s).`);

      for (const user of users) {
        await this.deleteLocalAccountUserById(user.id);
      }

      logger.info(`Deleted ${users.length} LocalAccount user(s).`);
    } catch (error: any) {
      spinner.fail("Failed to fetch LocalAccount users.");
      logger.error(`Error: ${error.message}`);
    }
  }

  public async listDeletedUsers(): Promise<void> {
    await this.initialize();
    const spinner = await this.createSpinner(
      "Fetching deleted users..."
    ).start();

    try {
      const response = await axios.get(
        `${this.graphRoot}directory/deletedItems/microsoft.graph.user`,
        {
          headers: { Authorization: `Bearer ${this.token}` },
          params: {
            $select:
              "displayName,mail,userPrincipalName,extension_8d70fb4f813c44f08d13356ad1d46c2b_User_id,creationType,deletedDateTime",
            $top: 999,
          },
        }
      );

      spinner.succeed("Fetched deleted users.");

      const deletedUsers: User[] = response.data?.value || [];

      if (deletedUsers.length > 0) {
        const tableData = deletedUsers.map((user, index) => [
          index + 1,
          user.displayName || "-",
          user.mail || user.userPrincipalName || "-",
          user.extension_8d70fb4f813c44f08d13356ad1d46c2b_User_id || "-",
          user.creationType || "-",
          new Date(user.deletedDateTime!).toLocaleString() || "-",
        ]);

        const output = table([
          [
            "ID",
            "Name",
            "Email",
            "Webportal_ID",
            "Creation_Type",
            "deletedDateTime",
          ],
          ...tableData,
        ]);
        logger.info("Deleted Users:\n" + output);
      } else {
        logger.warn("No deleted users found.");
      }
    } catch (error: any) {
      spinner.fail("Failed to fetch deleted users.");
      logger.error(`Error: ${error.message}`);
    }
  }

  public async restoreDeletedUserByWebportalId(
    webportalId: number
  ): Promise<boolean> {
    await this.initialize();
    const spinner = await this.createSpinner(
      `Restoring user with Webportal ID: ${webportalId}...`
    ).start();

    try {
      const ActiveResponse = await axios.get(`${this.graphRoot}users`, {
        headers: { Authorization: `Bearer ${this.token}` },
        params: {
          $filter: `creationType eq 'LocalAccount'`,
          $select:
            "id,mail,userPrincipalName,extension_8d70fb4f813c44f08d13356ad1d46c2b_User_id,creationType",
          $top: 999,
        },
      });

      const response = await axios.get(
        `${this.graphRoot}directory/deletedItems/microsoft.graph.user`,
        {
          headers: { Authorization: `Bearer ${this.token}` },
          params: {
            $filter: `creationType eq 'LocalAccount'`,
            $select:
              "id,displayName,mail,userPrincipalName,extension_8d70fb4f813c44f08d13356ad1d46c2b_User_id",
            $top: 999,
          },
        }
      );

      const deletedUsers: User[] = response.data?.value || [];
      const activeUsers: User[] = ActiveResponse.data?.value || [];

      const matchedUser = deletedUsers.find(
        (user) =>
          user.extension_8d70fb4f813c44f08d13356ad1d46c2b_User_id ===
          webportalId
      );

      if (!matchedUser) {
        spinner.fail(`No deleted user found with Webportal ID: ${webportalId}`);
        return false;
      }

      const sameUsers = activeUsers.find(
        (user) => matchedUser.mail === user.mail
      );

      if (sameUsers) {
        spinner.fail(
          `This user (${chalk.green(
            sameUsers.mail
          )}) is already peresent in entra: old Id ${
            matchedUser.extension_8d70fb4f813c44f08d13356ad1d46c2b_User_id
          } & new Id: ${
            sameUsers.extension_8d70fb4f813c44f08d13356ad1d46c2b_User_id
          } `
        );
        return false;
      }

      await axios.post(
        `${this.graphRoot}directory/deletedItems/${matchedUser.id}/restore`,
        {},
        {
          headers: { Authorization: `Bearer ${this.token}` },
        }
      );

      spinner.succeed(`Restored user: ${chalk.green(matchedUser.mail)}`);
      return true;
    } catch (error: any) {
      spinner.fail(`Failed to restore user with Webportal ID: ${webportalId}`);
      logger.error(`Error: ${error.message}`);
      return false;
    }
  }

  public async restoreMultipleUsersByWebportalIds(
    webportalIds: number[]
  ): Promise<void> {
    let restoredAny = false;
    let count = 0;

    for (const id of webportalIds) {
      const wasRestored = await this.restoreDeletedUserByWebportalId(id);
      if (wasRestored) {
        restoredAny = true;
        count += 1;
      }
    }

    if (restoredAny) {
      logger.info(
        `${count} user(s) restored. Fetching updated active user list...\n`
      );
      await this.listUsers();
    } else {
      logger.warn("No users were restored.");
    }
  }
}
