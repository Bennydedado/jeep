// check.h - the tiniest test helper: CHECK(cond) counts failures and says where.
#pragma once
#include <stdio.h>
static int failures = 0, checks = 0;
#define CHECK(c) do { checks++; if (!(c)) { failures++; printf("FAIL %s:%d  %s\n", __FILE__, __LINE__, #c); } } while (0)
#define NEAR(a, b, eps) CHECK(((a) - (b)) < (eps) && ((b) - (a)) < (eps))
#define DONE() do { printf("%s: %d checks, %d failed\n", __FILE__, checks, failures); return failures ? 1 : 0; } while (0)
