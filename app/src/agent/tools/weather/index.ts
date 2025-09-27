import { z } from 'zod';
import { zodToJsonSchemaBody } from '@/lib/utils';
import { ToolDefinition } from '../common';

const inputSchema = z.object({
  latitude: z.string().describe('Geographical WGS84 latitude of the location.'),
  longitude: z.string().describe('Geographical WGS84 longitude of the location.'),
});

const name = 'getWeather';

const handler = async (input: z.infer<typeof inputSchema>) => {
  const { latitude, longitude } = input;
  // please check Open Meteo license: https://open-meteo.com/en/license
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'MyApp/1.0',
        Accept: 'application/json',
      },
    });
    const weatherData = await response.json();
    console.log('weatherData:', weatherData);

    return weatherData;
  } catch (error) {
    const res = `Error fetching weather data: ${error instanceof Error ? error.message : String(error)} `;
    console.error(res, error);
    return res;
  }
};

export const getWeatherTool: ToolDefinition<z.infer<typeof inputSchema>> = {
  name,
  handler,
  schema: inputSchema,
  toolSpec: () => ({
    name,
    description: `Get the current weather for a given location, based on its WGS84 coordinates.`,
    inputSchema: {
      json: JSON.stringify(zodToJsonSchemaBody(inputSchema)),
    },
  }),
};
