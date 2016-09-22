/**
 * Registers commands and dispatches command calls to the
 * appropriate command classes
 */
class CommandManager
{
	/**
	 * @param {Bot} bot Discord.js client instance
	 */
	constructor(bot)
	{
		this.bot      = bot;
		this.info     = {};
		this.commands = [];

		this.bot.on("message", (message) =>
		{
			// Check if bot was mentioned
			let botMention = message.mentions.users.array().length > 0 &&
				message.mentions.users.first().id == this.bot.user.id;

			// Not a command, break
			if (message.content[0] != settings.prefix && !botMention) return;

			// Prevent bot messages triggering commands
			if (message.author.bot) return;

			// Get everything after mention/prefix from command
			let command;
			if (botMention) command = message.content.replace(/\<\@\d+\>/, "").trim();
			else command = message.content.slice(settings.prefix.length).trim();
			message.content = command;

			// Check for command matches and execute the
			// appropriate command if the user has valid
			// permissions
			this.commands.forEach( (item) =>
			{
				if (item instanceof Command && command.match(item.command))
				{
					// Break on admin commands if user is not in settings.admin list
					// This is for commands that should only be executed by those in control
					// of bot operations. For commands intended for server administrators
					// the "ADMINSTRATOR" permission should be used in the permissions array
					// property for the command rather than the admin boolean property
					if (!settings.admin.includes(message.author.id)) return;

					// Check permissions
					if (item.permissions.length > 0)
					{
						let missingPermissions = new Array();
						item.permissions.forEach( (permission) =>
						{
							if (!message.channel.permissionsFor(message.author).hasPermission(permission))
								missingPermissions.push(permission);
						});

						// Missing permissions, break
						if (missingPermissions.length > 0)
						{
							message.channel.sendMessage(
								`**You're missing the following permission` +
								`${missingPermissions.length > 1 ? "s" : ""} ` +
								`for that command:**\n\`\`\`css\n` +
								`${missingPermissions.join(", ")}\n\`\`\``)
									.then(message =>
									{
										message.delete(5 * 1000);
									});
							return;
						}
					}

					// Execute command action
					item.DoAction(message).then( (result) =>
					{
						this.bot.Say(result);
					}, (err) =>
					{
						this.bot.Say(err.stack ? err.stack.red : err.red);
					});
				}
			});
		})
	}

	/**
	 * Pass the Bot instance to the given command, add
	 * command to parent Array, and push command helptext
	 * fields to the info array for helpdocs
	 * @param {Command} command Command to be registered
	 * @param {number} index    The command registry index to place the command
	 * @returns {null}
	 */
	Register(command, index)
	{
		command.Register(this.bot);
		this.commands[index] = command;
		this.info[command.name] =
		{
			description: command.description,
			usage: command.usage,
			help: command.help,
			alias: command.alias,
			permissions: command.permissions,
			admin: command.admin || false
		}
	}
}

module.exports = CommandManager;
