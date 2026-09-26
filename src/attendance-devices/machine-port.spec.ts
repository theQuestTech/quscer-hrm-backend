import { isMachinePath, machineOnly } from './machine-port';

describe('machine-only port', () => {
  it('lets through only the attendance machine address', () => {
    expect(isMachinePath('/iclock/cdata?SN=ABC&options=all')).toBe(true);
    expect(isMachinePath('/iclock/getrequest')).toBe(true);
    expect(isMachinePath('/iclock')).toBe(true);
    expect(isMachinePath('/iclockx/cdata')).toBe(false);
    expect(isMachinePath('/auth/login')).toBe(false);
    expect(isMachinePath('/employees?x=/iclock/')).toBe(false);
    expect(isMachinePath(undefined)).toBe(false);
  });

  it('answers 404 for anything else without calling the app', () => {
    const app = jest.fn();
    const res: any = { setHeader: jest.fn(), end: jest.fn(), statusCode: 200 };
    machineOnly(app)({ url: '/auth/me' } as any, res);
    expect(app).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(404);
    machineOnly(app)({ url: '/iclock/cdata?SN=1' } as any, res);
    expect(app).toHaveBeenCalledTimes(1);
  });
});
