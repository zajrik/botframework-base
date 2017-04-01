import { Bot } from '../../bot/Bot';
import { Message } from '../../types/Message';
import { Command } from '../Command';
import { Middleware } from '../middleware/Middleware';
import * as CommandDecorators from '../CommandDecorators';
const { using } = CommandDecorators;

export default class extends Command<Bot>
{
	public constructor(bot: Bot)
	{
		super(bot, {
			name: 'setprefix',
			description: 'Set or check the bot command prefix for this guild',
			aliases: ['prefix'],
			usage: '<prefix>setprefix <prefix>',
			extraHelp: 'Prefixes may be 1-10 characters in length and may not include backslashes or backticks. Set the prefix to "noprefix" to allow commands to be called without a prefix.',
			permissions: ['ADMINISTRATOR']
		});
	}

	@using(Middleware.expect({ '<prefix>': 'String' }))
	public async action(message: Message, [prefix]: [string]): Promise<any>
	{
		if (!prefix)
			return this.respond(message, `${this.bot.getPrefix(message.guild)
				? `Current prefix is \`${this.bot.getPrefix(message.guild)}\``
				: 'There is currently no prefix.'}`);

		if (prefix.length > 10)
			return this.respond(message, `Prefixes may only be up to 10 chars in length.`);

		if (/[\\`]/.test(prefix))
			return this.respond(message, `Prefixes may not contain backticks or backslashes.`);

		if (prefix === 'noprefix') prefix = '';

		if (this.bot.selfbot)
			for (const guild of this.bot.storage.guilds.values())
				await guild.settings.set('prefix', prefix);

		else await this.bot.storage.guilds.get(message.guild.id).settings.set('prefix', prefix);
		this.respond(message, prefix === '' ? 'Command prefix removed.'
			: `Command prefix set to \`${prefix}\``);
	}
}