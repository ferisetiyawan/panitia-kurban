import { parsePreferensiTime } from './scheduling-mappers';

describe('parsePreferensiTime', () => {
  it.each([
    ['Jam 07.00 sd.07.30', { hour: 7, minute: 0 }],
    ['Jam 07.30 sd 08.00', { hour: 7, minute: 30 }],
    ['Jam 08.30 sd 09.00', { hour: 8, minute: 30 }],
    ['Jam 12.00 sd 12.30', { hour: 12, minute: 0 }],
  ])('parses %j', (input, expected) => {
    expect(parsePreferensiTime(input as string)).toEqual(expected);
  });

  it.each([
    ['', null],
    [null, null],
    [undefined, null],
    ['jam invalid', null],
    ['Jam 25.00 sd 25.30', null],
    ['Jam ab.cd sd ef.gh', null],
  ])('returns null for %j', (input, expected) => {
    expect(parsePreferensiTime(input as any)).toEqual(expected);
  });
});
