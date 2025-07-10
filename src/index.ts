import { Command } from "commander";
import { ExitPromptError } from "@inquirer/core";
import inquirer from "inquirer";
import { UserManager } from "./userManager";
import logger from "./utils/logger";
import ora from "ora";

const program = new Command();
const userManager = new UserManager();

let isAuthenticated = false;

async function authenticateUser() {
  const { email } = await inquirer.prompt([
    {
      type: "input",
      name: "email",
      message: "Enter your work email:",
      validate(input) {
        return /\S+@\S+\.\S+/.test(input) || "Enter a valid email address";
      },
    },
  ]);

  try {
    const token = await userManager.verifyLogin(email);

    if (token) {
      ora().succeed("Authenticated!");
      isAuthenticated = true;
    } else {
      ora().fail("Authentication failed.");
      isAuthenticated = false;
    }
  } catch (err) {
    logger.error("Error in authentication:", err);
    isAuthenticated = false;
  }
}

program
  .name("user-manager")
  .description("CLI to manage Entra ID users")
  .version("1.0.0");

program
  .command("list")
  .description("List all active users")
  .action(async () => {
    if (!isAuthenticated) await authenticateUser();
    if (isAuthenticated) await userManager.listUsers();
  });

program
  .command("list-deleted")
  .description("List all deleted users")
  .action(async () => {
    if (!isAuthenticated) await authenticateUser();
    if (isAuthenticated) await userManager.listDeletedUsers();
  });

program
  .command("delete-multiple <webportalIds>")
  .description("Delete multiple LocalAccount users (comma-separated IDs)")
  .action(async (webportalIds: string) => {
    if (!isAuthenticated) await authenticateUser();
    if (!isAuthenticated) return;
    const ids = webportalIds.split(",").map((id) => Number(id.trim()));
    await userManager.deleteMultipleUsers(ids);
  });

program
  .command("delete-all-local")
  .description("Delete ALL users with creationType 'LocalAccount'")
  .action(async () => {
    if (!isAuthenticated) await authenticateUser();
    if (isAuthenticated) await userManager.deleteAllLocalAccountUsers();
  });

program
  .command("restore-multiple <webportalIds>")
  .description("Restore multiple deleted users (comma-separated IDs)")
  .action(async (webportalIds: string) => {
    if (!isAuthenticated) await authenticateUser();
    if (!isAuthenticated) return;
    const ids = webportalIds.split(",").map((id) => Number(id.trim()));
    await userManager.restoreMultipleUsersByWebportalIds(ids);
  });

async function showMenu() {
  const { option } = await inquirer.prompt([
    {
      type: "rawlist",
      name: "option",
      message: "Select an action:",
      choices: [
        { name: "List - all active users", value: "list" },
        { name: "List - all deleted users", value: "list-deleted" },
        { name: "Delete - single/multiple users", value: "delete-multiple" },
        {
          name: "Delete - all local account users",
          value: "delete-all-local",
        },
        {
          name: "Restore - single/multiple users",
          value: "restore-multiple",
        },
        { name: "Clear history", value: "clear-history" },
        { name: "Exit", value: "exit" },
      ],
    },
  ]);

  switch (option) {
    case "list":
      await userManager.listUsers();
      break;
    case "list-deleted":
      await userManager.listDeletedUsers();
      break;
    case "delete-multiple":
      const { deleteIds } = await inquirer.prompt([
        {
          type: "input",
          name: "deleteIds",
          message: "Enter comma-separated Webportal IDs to delete:",
        },
      ]);
      const idsToDelete = deleteIds
        .split(",")
        .map((id: string) => Number(id.trim()));
      await userManager.deleteMultipleUsers(idsToDelete);
      break;
    case "delete-all-local":
      await userManager.deleteAllLocalAccountUsers();
      break;
    case "restore-multiple":
      const { restoreIds } = await inquirer.prompt([
        {
          type: "input",
          name: "restoreIds",
          message: "Enter comma-separated Webportal IDs to restore:",
        },
      ]);
      const idsToRestore = restoreIds
        .split(",")
        .map((id: string) => Number(id.trim()));
      await userManager.restoreMultipleUsersByWebportalIds(idsToRestore);
      break;
    case "clear-history":
      const spinner = ora("Clearing history...").start();
      await new Promise((res) => setTimeout(res, 1000));
      spinner.succeed("History cleared");
      logger.info("cleared");
      process.stdout.write("\x1Bc");
      break;
    case "exit":
    default:
      isAuthenticated = false;
      logger.info("Goodbye!");
      process.exit(0);
  }

  return true;
}

async function main() {
  process.stdout.write("\x1Bc");
  await authenticateUser();

  if (!isAuthenticated) {
    logger.error("Authentication failed. Exiting...");
    process.exit(1);
  }

  while (isAuthenticated) {
    const shouldContinue = await showMenu();
    if (!shouldContinue || !isAuthenticated) break;

    const { continueChoice } = await inquirer.prompt([
      {
        type: "confirm",
        name: "continueChoice",
        message: "Return to main menu?",
        default: true,
      },
    ]);

    if (!continueChoice) {
      logger.info("Goodbye!");
      break;
    }
  }
}

(async () => {
  try {
    if (!process.argv.slice(2).length) {
      await main();
    } else {
      await program.parseAsync(process.argv);
    }
  } catch (err: unknown) {
    const error = err as Error;
    if (err instanceof ExitPromptError || error.message.includes("SIGINT")) {
      logger.info("Exiting...\n");
      process.exit(0);
    } else {
      logger.error("An unexpected error occurred:", error);
      process.exit(1);
    }
  }
})();
