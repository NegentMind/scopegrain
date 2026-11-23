# Regresión y casos límite

Los casos útiles ejercitan el fallo original, entradas vacías/inválidas,
operaciones duplicadas, revisiones obsoletas, enlaces, escrituras parciales
y propiedad concurrente donde sea relevante. Los casos negativos deberían
aseverar la ausencia de efectos laterales no autorizados. Usa fixtures
desechables propios y expectativas deterministas. No debilites el
comportamiento del producto para compensar un fixture de prueba roto.

Referencia rápida de patrones de testing comunes a lo largo del stack. Los
ejemplos usan modismos estilo TypeScript/Jest; los patrones se transfieren
a cualquier framework de pruebas.

## Tabla de contenidos

- [Estructura de prueba (Arrange-Act-Assert)](#estructura-de-prueba-arrange-act-assert)
- [Convenciones de naming de pruebas](#convenciones-de-naming-de-pruebas)
- [Aserciones comunes](#aserciones-comunes)
- [Patrones de mocking](#patrones-de-mocking)
- [Pruebas de componentes](#pruebas-de-componentes)
- [Pruebas de API / integración](#pruebas-de-api--integración)
- [Pruebas E2E](#pruebas-e2e)
- [Anti-patrones de pruebas](#anti-patrones-de-pruebas)

## Estructura de prueba (Arrange-Act-Assert)

```typescript
it('describes expected behavior', () => {
  // Arrange: Set up test data and preconditions
  const input = { title: 'Test Task', priority: 'high' };

  // Act: Perform the action being tested
  const result = createTask(input);

  // Assert: Verify the outcome
  expect(result.title).toBe('Test Task');
  expect(result.priority).toBe('high');
  expect(result.status).toBe('pending');
});
```

## Convenciones de naming de pruebas

```typescript
// Pattern: [unit] [expected behavior] [condition]
describe('TaskService.createTask', () => {
  it('creates a task with default pending status', () => {});
  it('throws ValidationError when title is empty', () => {});
  it('trims whitespace from title', () => {});
  it('generates a unique ID for each task', () => {});
});
```

## Aserciones comunes

```typescript
// Equality
expect(result).toBe(expected);           // Strict equality (===)
expect(result).toEqual(expected);        // Deep equality (objects/arrays)
expect(result).toStrictEqual(expected);  // Deep equality + type matching

// Truthiness
expect(result).toBeTruthy();
expect(result).toBeFalsy();
expect(result).toBeNull();
expect(result).toBeDefined();
expect(result).toBeUndefined();

// Numbers
expect(result).toBeGreaterThan(5);
expect(result).toBeLessThanOrEqual(10);
expect(result).toBeCloseTo(0.3, 5);      // Floating point

// Strings
expect(result).toMatch(/pattern/);
expect(result).toContain('substring');

// Arrays / Objects
expect(array).toContain(item);
expect(array).toHaveLength(3);
expect(object).toHaveProperty('key', 'value');

// Errors
expect(() => fn()).toThrow();
expect(() => fn()).toThrow(ValidationError);
expect(() => fn()).toThrow('specific message');

// Async
await expect(asyncFn()).resolves.toBe(value);
await expect(asyncFn()).rejects.toThrow(Error);
```

## Patrones de mocking

### Funciones mock

```typescript
const mockFn = jest.fn();
mockFn.mockReturnValue(42);
mockFn.mockResolvedValue({ data: 'test' });
mockFn.mockImplementation((x) => x * 2);

expect(mockFn).toHaveBeenCalled();
expect(mockFn).toHaveBeenCalledWith('arg1', 'arg2');
expect(mockFn).toHaveBeenCalledTimes(3);
```

### Módulos mock

```typescript
// Mock an entire module
jest.mock('./database', () => ({
  query: jest.fn().mockResolvedValue([{ id: 1, title: 'Test' }]),
}));

// Mock specific exports
jest.mock('./utils', () => ({
  ...jest.requireActual('./utils'),
  generateId: jest.fn().mockReturnValue('test-id'),
}));
```

### Mockea solo en las fronteras

```
Mock these:                    Don't mock these:
├── Database calls             ├── Internal utility functions
├── HTTP requests              ├── Business logic
├── File system operations     ├── Data transformations
├── External API calls         ├── Validation functions
└── Time/Date (when needed)    └── Pure functions
```

## Pruebas de componentes

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

describe('TaskForm', () => {
  it('submits the form with entered data', async () => {
    const onSubmit = jest.fn();
    render(<TaskForm onSubmit={onSubmit} />);

    // Find elements by accessible role/label (not test IDs)
    await screen.findByRole('textbox', { name: /title/i });
    fireEvent.change(screen.getByRole('textbox', { name: /title/i }), {
      target: { value: 'New Task' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({ title: 'New Task' });
    });
  });

  it('shows validation error for empty title', async () => {
    render(<TaskForm onSubmit={jest.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /create/i }));

    expect(await screen.findByText(/title is required/i)).toBeInTheDocument();
  });
});
```

## Pruebas de API / integración

```typescript
import request from 'supertest';
import { app } from '../src/app';

describe('POST /api/tasks', () => {
  it('creates a task and returns 201', async () => {
    const response = await request(app)
      .post('/api/tasks')
      .send({ title: 'Test Task' })
      .set('Authorization', `Bearer ${testToken}`)
      .expect(201);

    expect(response.body).toMatchObject({
      id: expect.any(String),
      title: 'Test Task',
      status: 'pending',
    });
  });

  it('returns 422 for invalid input', async () => {
    const response = await request(app)
      .post('/api/tasks')
      .send({ title: '' })
      .set('Authorization', `Bearer ${testToken}`)
      .expect(422);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 401 without authentication', async () => {
    await request(app)
      .post('/api/tasks')
      .send({ title: 'Test' })
      .expect(401);
  });
});
```

## Pruebas E2E

```typescript
import { test, expect } from '@playwright/test';

test('user can create and complete a task', async ({ page }) => {
  // Navigate and authenticate
  await page.goto('/');
  await page.getByRole('textbox', { name: /email/i }).fill('test@example.com');
  await page.getByLabel(/password/i).fill('testpass123');
  await page.getByRole('button', { name: /log in/i }).click();

  // Create a task
  await page.getByRole('button', { name: /new task/i }).click();
  await page.getByRole('textbox', { name: /title/i }).fill('Buy groceries');
  await page.getByRole('button', { name: /create/i }).click();

  // Verify task appears
  const task = page.getByRole('listitem', { name: /buy groceries/i });
  await expect(task).toBeVisible();

  // Complete the task
  await task.getByRole('checkbox', { name: /complete buy groceries/i }).check();
  await expect(task).toHaveCSS('text-decoration-line', 'line-through');
});
```

## Anti-patrones de pruebas

| Anti-patrón | Problema | Mejor enfoque |
|---|---|---|
| Probar detalles de implementación | Se rompe al refactorizar | Prueba entradas/salidas |
| Snapshot de todo | Nadie revisa los diffs de snapshot | Asevera valores específicos |
| Estado mutable compartido | Las pruebas se contaminan entre sí | Setup/teardown por prueba |
| Probar código de terceros | Pierde tiempo, no es tu bug | Mockea la frontera |
| Omitir pruebas para pasar CI | Oculta bugs reales | Arregla o elimina la prueba |
| Usar `test.skip` permanentemente | Código muerto | Elimínalo o arréglalo |
| Aserciones demasiado amplias | No captura regresiones | Sé específico |
| Sin manejo de errores async | Errores tragados, falsos pases | Haz siempre `await` en pruebas async |

<!-- Cross-references: → see test-suite.md, definition-of-done.md, quality-floor.md -->
