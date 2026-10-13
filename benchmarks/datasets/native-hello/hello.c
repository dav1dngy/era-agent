#include <stdio.h>
#include <string.h>

/* Benchmark fixture: small authored program with known functions. */
static unsigned int checksum(const char *s) {
    unsigned int h = 5381;
    while (*s) h = ((h << 5) + h) + (unsigned char)*s++;
    return h;
}

int greet(const char *name) {
    printf("Hello, %s! checksum=%u\n", name, checksum(name));
    return (int)strlen(name);
}

int main(int argc, char **argv) {
    const char *who = argc > 1 ? argv[1] : "ERA";
    return greet(who) > 64 ? 1 : 0;
}
