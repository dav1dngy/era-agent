/* Sandbox probe (test fixture): reports whether it can write outside its
 * working directory and whether it can open a network connection. */
#include <arpa/inet.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/socket.h>
#include <unistd.h>

int main(int argc, char **argv) {
    const char *outside = argc > 1 ? argv[1] : "/tmp/era-sandbox-probe-outside.txt";
    FILE *f = fopen("inside.txt", "w");
    printf("scratch-write: %s\n", f ? "allowed" : "denied");
    if (f) fclose(f);
    f = fopen(outside, "w");
    printf("outside-write: %s\n", f ? "allowed" : "denied");
    if (f) { fclose(f); unlink(outside); }
    int s = socket(AF_INET, SOCK_STREAM, 0);
    struct sockaddr_in a = { .sin_family = AF_INET, .sin_port = htons(80) };
    inet_pton(AF_INET, "1.1.1.1", &a.sin_addr);
    int c = s >= 0 ? connect(s, (struct sockaddr *)&a, sizeof a) : -1;
    printf("network: %s\n", c == 0 ? "allowed" : "denied");
    return 0;
}
