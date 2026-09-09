terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = "eu-north-1"
}

data "aws_ssm_parameter" "amazon_linux" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}

resource "aws_security_group" "web" {
  name_prefix = "linux-explainer-"
  description = "Linux Command Explainer HTTP and SSH"
  vpc_id      = "vpc-022797c3c4b910a7b"

  ingress {
    description = "SSH from my public IP"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["78.73.30.214/32"]
  }

  ingress {
    description = "Public website"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "linux-command-explainer"
  }
}

resource "aws_instance" "web" {
  ami                         = data.aws_ssm_parameter.amazon_linux.value
  instance_type               = "t3.micro"
  subnet_id                   = "subnet-0223597407143adbe"
  key_name                    = "devops.school.level3.Alex_Kiyaga"
  associate_public_ip_address = true
  vpc_security_group_ids      = [aws_security_group.web.id]

  user_data = <<-SCRIPT
    #!/bin/bash
    set -euo pipefail
    dnf install -y python3.12 python3.12-pip
  SCRIPT

  user_data_replace_on_change = true

  root_block_device {
    volume_size           = 12
    volume_type           = "gp3"
    encrypted             = true
    delete_on_termination = true
  }

  metadata_options {
    http_endpoint = "enabled"
    http_tokens   = "required"
  }

  tags = {
    Name = "linux-command-explainer"
  }
}

output "public_ip" {
  value = aws_instance.web.public_ip
}

output "website_url" {
  value = "http://${aws_instance.web.public_ip}"
}

output "ssh_command" {
  value = "ssh -i ~/.ssh/id_rsa_level3 ec2-user@${aws_instance.web.public_ip}"
}
